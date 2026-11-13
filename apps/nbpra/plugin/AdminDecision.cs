using System;
using System.Linq;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using C = Nbpra.Plugins.Choices;

namespace Nbpra.Plugins
{
    /// <summary>
    /// Custom API nbpra_AdminDecision: Kate's onboarding and committee-admission
    /// decisions (requirements FR-08, FR-09, FR-25, section 5.4).
    ///
    /// Inputs:  SubmissionId, Action, Comment, Channel (all strings).
    ///          Action is approveOnboarding | denyOnboarding | authorize | returnFinal | rejectFinal.
    /// Outputs: Outcome (accepted | already_resolved | unauthorized | validation_failed), Message, NewStatus.
    ///
    /// Runs in the operation's transaction. Every check happens before the first
    /// write, and a refused request writes nothing.
    /// </summary>
    public class AdminDecision : IPlugin
    {
        private const string AdminRole = "NBPRA Administrator";

        private sealed class Spec
        {
            public int From, To, Purpose, RequestStatus, Outcome, EventType;
            public bool NeedsReason, NeedsSlot;
            public string Label;
        }

        private static Spec SpecFor(string action)
        {
            switch (action)
            {
                case "approveOnboarding":
                    return new Spec { From = C.SubmissionStatus.AwaitingOnboardingReview, To = C.SubmissionStatus.ChecklistInProgress, Purpose = C.ApprovalPurpose.Onboarding, RequestStatus = C.ApprovalStatus.Approved, Outcome = C.DecisionOutcome.Approve, EventType = C.EventType.Slot, NeedsSlot = true, Label = "Onboarding approved; slot confirmed" };
                case "denyOnboarding":
                    return new Spec { From = C.SubmissionStatus.AwaitingOnboardingReview, To = C.SubmissionStatus.OnboardingDenied, Purpose = C.ApprovalPurpose.Onboarding, RequestStatus = C.ApprovalStatus.Denied, Outcome = C.DecisionOutcome.Deny, EventType = C.EventType.Slot, NeedsReason = true, Label = "Onboarding denied" };
                case "authorize":
                    return new Spec { From = C.SubmissionStatus.AwaitingFinalAdminReview, To = C.SubmissionStatus.AuthorizedForCommittee, Purpose = C.ApprovalPurpose.FinalCommitteeAdmission, RequestStatus = C.ApprovalStatus.Approved, Outcome = C.DecisionOutcome.Approve, EventType = C.EventType.Admission, NeedsSlot = true, Label = "Committee attendance authorized" };
                case "returnFinal":
                    return new Spec { From = C.SubmissionStatus.AwaitingFinalAdminReview, To = C.SubmissionStatus.FinalChangesRequested, Purpose = C.ApprovalPurpose.FinalCommitteeAdmission, RequestStatus = C.ApprovalStatus.ChangesRequested, Outcome = C.DecisionOutcome.ChangesRequested, EventType = C.EventType.Admission, NeedsReason = true, Label = "Returned for changes" };
                case "rejectFinal":
                    return new Spec { From = C.SubmissionStatus.AwaitingFinalAdminReview, To = C.SubmissionStatus.FinalRejected, Purpose = C.ApprovalPurpose.FinalCommitteeAdmission, RequestStatus = C.ApprovalStatus.Denied, Outcome = C.DecisionOutcome.Reject, EventType = C.EventType.Admission, NeedsReason = true, Label = "Admission rejected" };
                default:
                    return null;
            }
        }

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            // Writes run as SYSTEM so ordinary roles need no direct write access to
            // decisions, events or status. The human actor is recorded explicitly.
            var svc = factory.CreateOrganizationService(null);
            var actor = ctx.InitiatingUserId;

            void Reply(string outcome, string message, string newStatus = null)
            {
                ctx.OutputParameters["Outcome"] = outcome;
                ctx.OutputParameters["Message"] = message;
                ctx.OutputParameters["NewStatus"] = newStatus ?? string.Empty;
            }

            string In(string name) => ctx.InputParameters.Contains(name) ? ctx.InputParameters[name] as string : null;

            var action = In("Action");
            var comment = (In("Comment") ?? string.Empty).Trim();
            var spec = SpecFor(action);
            if (spec == null) { Reply("validation_failed", "Unknown action."); return; }
            if (!Guid.TryParse(In("SubmissionId"), out var submissionId)) { Reply("validation_failed", "SubmissionId is not a valid identifier."); return; }
            int channel;
            switch ((In("Channel") ?? "App").ToLowerInvariant())
            {
                case "teams": channel = C.Channel.Teams; break;
                case "email": channel = C.Channel.Email; break;
                default: channel = C.Channel.App; break;
            }

            if (!IsAdmin(svc, actor)) { Reply("unauthorized", "Only an NBPRA Administrator can record this decision."); return; }

            Entity sub;
            try
            {
                sub = svc.Retrieve("nbpra_submission", submissionId, new ColumnSet("nbpra_status", "nbpra_name", "nbpra_businessowner", "nbpra_currentslotrequest", "nbpra_assignedslot", "nbpra_packagerevision", "nbpra_checklisttemplate", "nbpra_copiedfrom"));
            }
            catch (Exception)
            {
                Reply("validation_failed", "Submission not found.");
                return;
            }

            var status = sub.GetAttributeValue<OptionSetValue>("nbpra_status")?.Value ?? 0;
            if (status != spec.From)
            {
                Reply("already_resolved", "This request has already been resolved. Current status: " + C.SubmissionStatus.Label(status) + ".", C.SubmissionStatus.Label(status));
                return;
            }
            if (spec.NeedsReason && comment.Length == 0) { Reply("validation_failed", "Enter a reason before recording this decision."); return; }

            var owner = sub.GetAttributeValue<EntityReference>("nbpra_businessowner");
            if (owner != null && owner.Id == actor && !AllowSelfApproval(svc))
            {
                Reply("unauthorized", "You cannot decide your own submission. An authorized alternate must act.");
                return;
            }

            var onboarding = spec.Purpose == C.ApprovalPurpose.Onboarding;
            Entity slotRequest = null;
            var slotRequestRef = sub.GetAttributeValue<EntityReference>("nbpra_currentslotrequest");
            if (onboarding)
            {
                if (slotRequestRef == null)
                {
                    // Records loaded from a spreadsheet may not have the pointer set; use the one pending request.
                    var pending = Sections.Rows(svc, "nbpra_slotrequest", new ColumnSet(false), ("nbpra_submission", submissionId), ("nbpra_status", C.SlotRequestStatus.Pending));
                    if (pending.Count == 1) slotRequestRef = pending[0].ToEntityReference();
                }
                if (slotRequestRef == null) { Reply("validation_failed", "The submission has no onboarding request to decide."); return; }
                slotRequest = svc.Retrieve("nbpra_slotrequest", slotRequestRef.Id, new ColumnSet("nbpra_status", "nbpra_requestedslot", "nbpra_revisionnumber", "nbpra_decisionrequest"));
                if ((slotRequest.GetAttributeValue<OptionSetValue>("nbpra_status")?.Value ?? 0) != C.SlotRequestStatus.Pending)
                {
                    Reply("already_resolved", "This onboarding request is no longer pending.", C.SubmissionStatus.Label(status));
                    return;
                }
            }

            // Slot checks. Touching the slot row first takes its lock, so two
            // approvals competing for the last place are decided one at a time.
            EntityReference slotRef = null;
            var activeAllocations = 0;
            if (spec.NeedsSlot)
            {
                slotRef = onboarding ? slotRequest.GetAttributeValue<EntityReference>("nbpra_requestedslot") : sub.GetAttributeValue<EntityReference>("nbpra_assignedslot");
                if (slotRef == null) { Reply("validation_failed", "There is no valid meeting slot. Assign a slot before approving."); return; }

                var slot = svc.Retrieve("nbpra_slot", slotRef.Id, new ColumnSet("nbpra_status", "nbpra_capacity", "nbpra_meeting", "nbpra_activeallocationcount"));
                var lockRow = new Entity("nbpra_slot", slotRef.Id);
                lockRow["nbpra_activeallocationcount"] = slot.GetAttributeValue<int?>("nbpra_activeallocationcount") ?? 0;
                svc.Update(lockRow);

                var slotStatus = slot.GetAttributeValue<OptionSetValue>("nbpra_status")?.Value ?? C.SlotStatus.Open;
                var slotOk = onboarding ? slotStatus == C.SlotStatus.Open : (slotStatus == C.SlotStatus.Open || slotStatus == C.SlotStatus.Closed);
                if (!slotOk) throw new InvalidPluginExecutionException(OperationStatus.Failed, "The slot is not available.");

                var meetingRef = slot.GetAttributeValue<EntityReference>("nbpra_meeting");
                if (meetingRef != null)
                {
                    var meeting = svc.Retrieve("nbpra_meeting", meetingRef.Id, new ColumnSet("nbpra_status"));
                    if ((meeting.GetAttributeValue<OptionSetValue>("nbpra_status")?.Value ?? C.MeetingStatus.Open) == C.MeetingStatus.Canceled)
                        throw new InvalidPluginExecutionException(OperationStatus.Failed, "The meeting has been canceled. Assign another slot.");
                }

                if (onboarding)
                {
                    var q = new QueryExpression("nbpra_slotrequest") { ColumnSet = new ColumnSet(false) };
                    q.Criteria.AddCondition("nbpra_assignedslot", ConditionOperator.Equal, slotRef.Id);
                    q.Criteria.AddCondition("nbpra_allocationactive", ConditionOperator.Equal, true);
                    activeAllocations = svc.RetrieveMultiple(q).Entities.Count;
                    var capacity = slot.GetAttributeValue<int?>("nbpra_capacity") ?? 1;
                    if (activeAllocations >= capacity)
                        throw new InvalidPluginExecutionException(OperationStatus.Failed, "That slot is full. Choose another slot for this request.");
                }
            }

            // ---- all checks passed; write the decision ----
            var now = DateTime.UtcNow;
            var packageRevision = sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0;
            var subject = onboarding ? "Onboarding rev " + (slotRequest.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 1) : "Package rev " + packageRevision;
            var subRef = new EntityReference("nbpra_submission", submissionId);
            var actorRef = new EntityReference("systemuser", actor);

            var requestId = FindOrCreateRequest(svc, subRef, spec.Purpose, slotRequest, packageRevision, sub.GetAttributeValue<string>("nbpra_name"));
            var request = new Entity("nbpra_approvalrequest", requestId);
            request["nbpra_status"] = new OptionSetValue(spec.RequestStatus);
            request["nbpra_closedat"] = now;
            svc.Update(request);

            var assignment = new Entity("nbpra_approvalassignment");
            assignment["nbpra_name"] = spec.Label;
            assignment["nbpra_approvalrequest"] = new EntityReference("nbpra_approvalrequest", requestId);
            assignment["nbpra_assigneduser"] = actorRef;
            assignment["nbpra_assignedat"] = now;
            assignment["nbpra_status"] = new OptionSetValue(C.AssignmentStatus.Completed);
            var assignmentId = svc.Create(assignment);

            var decision = new Entity("nbpra_approvaldecision");
            decision["nbpra_name"] = spec.Label;
            decision["nbpra_approvalrequest"] = new EntityReference("nbpra_approvalrequest", requestId);
            decision["nbpra_assignment"] = new EntityReference("nbpra_approvalassignment", assignmentId);
            decision["nbpra_actor"] = actorRef;
            decision["nbpra_outcome"] = new OptionSetValue(spec.Outcome);
            decision["nbpra_comment"] = comment;
            decision["nbpra_decidedat"] = now;
            decision["nbpra_channel"] = new OptionSetValue(channel);
            decision["nbpra_correlationid"] = requestId.ToString("N") + ":decision";
            decision["nbpra_subjectrevisionreference"] = subject;
            svc.Create(decision);

            var subUpdate = new Entity("nbpra_submission", submissionId);
            subUpdate["nbpra_status"] = new OptionSetValue(spec.To);
            subUpdate["nbpra_lastbusinessactivityat"] = now;

            if (onboarding)
            {
                var sr = new Entity("nbpra_slotrequest", slotRequest.Id);
                if (action == "approveOnboarding")
                {
                    sr["nbpra_status"] = new OptionSetValue(C.SlotRequestStatus.Approved);
                    sr["nbpra_assignedslot"] = slotRef;
                    sr["nbpra_allocationactive"] = true;
                    subUpdate["nbpra_assignedslot"] = slotRef;
                    var slotUpdate = new Entity("nbpra_slot", slotRef.Id);
                    slotUpdate["nbpra_activeallocationcount"] = activeAllocations + 1;
                    svc.Update(slotUpdate);
                }
                else
                {
                    sr["nbpra_status"] = new OptionSetValue(C.SlotRequestStatus.Denied);
                }
                sr["nbpra_decisionrequest"] = new EntityReference("nbpra_approvalrequest", requestId);
                svc.Update(sr);
                subUpdate["nbpra_currentslotrequest"] = slotRequest.ToEntityReference();
            }
            else if (action == "authorize")
            {
                subUpdate["nbpra_committeeauthorizedat"] = now;
                subUpdate["nbpra_committeeauthorizedby"] = actorRef;
            }

            if (action == "approveOnboarding")
            {
                var templateRef = sub.GetAttributeValue<EntityReference>("nbpra_checklisttemplate") ?? PinTemplateAndSections(svc, subRef);
                if (templateRef != null) subUpdate["nbpra_checklisttemplate"] = templateRef;
                // A submission started from an earlier one opens with that one's answers as drafts.
                var copiedFrom = sub.GetAttributeValue<EntityReference>("nbpra_copiedfrom");
                if (copiedFrom != null && owner != null) Sections.Prefill(svc, submissionId, copiedFrom.Id, owner);
            }
            svc.Update(subUpdate);

            WriteEvent(svc, subRef, spec.EventType, spec.Label, now, actorRef, C.ActorKind.Human, "nbpra_approvalrequest", requestId,
                C.SubmissionStatus.Label(spec.From), C.SubmissionStatus.Label(spec.To), comment, channel, requestId.ToString("N") + ":" + action, subject);
            if (action == "approveOnboarding")
            {
                WriteEvent(svc, subRef, C.EventType.Checklist, "Checklist unlocked", now, null, C.ActorKind.System, "nbpra_submission", submissionId,
                    null, null, null, C.Channel.System, requestId.ToString("N") + ":unlock", subject);
            }
            if (action == "returnFinal")
            {
                WriteEvent(svc, subRef, C.EventType.Invalidation, "Five signatory approvals invalidated", now, null, C.ActorKind.System, "nbpra_submission", submissionId,
                    null, null, "Package returned for changes.", C.Channel.System, requestId.ToString("N") + ":invalidate", subject);
            }

            Reply("accepted", spec.Label + ".", C.SubmissionStatus.Label(spec.To));
        }

        internal static bool IsAdmin(IOrganizationService svc, Guid userId)
        {
            var q = new QueryExpression("role") { ColumnSet = new ColumnSet("name") };
            var link = q.AddLink("systemuserroles", "roleid", "roleid");
            link.LinkCriteria.AddCondition("systemuserid", ConditionOperator.Equal, userId);
            q.Criteria.AddCondition("name", ConditionOperator.In, AdminRole, "System Administrator");
            return svc.RetrieveMultiple(q).Entities.Any();
        }

        /// <summary>Test switch: environment variable nbpra_AllowSelfApproval = "true". Off unless set.</summary>
        internal static bool AllowSelfApproval(IOrganizationService svc) => Flag(svc, "nbpra_AllowSelfApproval");

        /// <summary>Reads a true/false environment variable; false when it is missing.</summary>
        internal static bool Flag(IOrganizationService svc, string schemaName)
        {
            var q = new QueryExpression("environmentvariabledefinition") { ColumnSet = new ColumnSet("defaultvalue") };
            q.Criteria.AddCondition("schemaname", ConditionOperator.Equal, schemaName);
            var v = q.AddLink("environmentvariablevalue", "environmentvariabledefinitionid", "environmentvariabledefinitionid", JoinOperator.LeftOuter);
            v.EntityAlias = "v";
            v.Columns = new ColumnSet("value");
            var def = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
            if (def == null) return false;
            var value = (def.GetAttributeValue<AliasedValue>("v.value")?.Value as string) ?? def.GetAttributeValue<string>("defaultvalue");
            return string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);
        }

        private static Guid FindOrCreateRequest(IOrganizationService svc, EntityReference subRef, int purpose, Entity slotRequest, int packageRevision, string title)
        {
            var q = new QueryExpression("nbpra_approvalrequest") { ColumnSet = new ColumnSet(false), TopCount = 1 };
            q.Criteria.AddCondition("nbpra_submission", ConditionOperator.Equal, subRef.Id);
            q.Criteria.AddCondition("nbpra_purpose", ConditionOperator.Equal, purpose);
            q.Criteria.AddCondition("nbpra_status", ConditionOperator.Equal, C.ApprovalStatus.Pending);
            q.AddOrder("createdon", OrderType.Descending);
            var found = svc.RetrieveMultiple(q).Entities.FirstOrDefault();
            if (found != null) return found.Id;

            var onboarding = purpose == C.ApprovalPurpose.Onboarding;
            var r = new Entity("nbpra_approvalrequest");
            r["nbpra_name"] = (onboarding ? "Onboarding: " : "Committee admission: ") + title;
            r["nbpra_submission"] = subRef;
            r["nbpra_purpose"] = new OptionSetValue(purpose);
            r["nbpra_policy"] = new OptionSetValue(C.ApprovalPolicy.OneAuthorized);
            r["nbpra_status"] = new OptionSetValue(C.ApprovalStatus.Pending);
            if (onboarding) r["nbpra_slotrequest"] = slotRequest.ToEntityReference();
            else r["nbpra_packagerevision"] = packageRevision;
            r["nbpra_idempotencykey"] = subRef.Id.ToString("N") + (onboarding ? ":onboarding:" + slotRequest.Id.ToString("N") : ":final:" + packageRevision);
            return svc.Create(r);
        }

        /// <summary>Pins the newest published template and creates one section instance per section.</summary>
        private static EntityReference PinTemplateAndSections(IOrganizationService svc, EntityReference subRef)
        {
            var tq = new QueryExpression("nbpra_template") { ColumnSet = new ColumnSet("nbpra_version"), TopCount = 1 };
            tq.Criteria.AddCondition("nbpra_status", ConditionOperator.Equal, C.TemplateStatus.Published);
            tq.AddOrder("nbpra_version", OrderType.Descending);
            var template = svc.RetrieveMultiple(tq).Entities.FirstOrDefault();
            if (template == null) return null;

            var existing = new QueryExpression("nbpra_sectioninstance") { ColumnSet = new ColumnSet("nbpra_sectiondef") };
            existing.Criteria.AddCondition("nbpra_submission", ConditionOperator.Equal, subRef.Id);
            var have = svc.RetrieveMultiple(existing).Entities.Select(e => e.GetAttributeValue<EntityReference>("nbpra_sectiondef")?.Id).ToList();

            var sq = new QueryExpression("nbpra_sectiondef") { ColumnSet = new ColumnSet("nbpra_name") };
            sq.Criteria.AddCondition("nbpra_template", ConditionOperator.Equal, template.Id);
            foreach (var def in svc.RetrieveMultiple(sq).Entities.Where(d => !have.Contains(d.Id)))
            {
                var si = new Entity("nbpra_sectioninstance");
                si["nbpra_name"] = def.GetAttributeValue<string>("nbpra_name");
                si["nbpra_submission"] = subRef;
                si["nbpra_sectiondef"] = def.ToEntityReference();
                si["nbpra_status"] = new OptionSetValue(C.SectionStatus.NotStarted);
                si["nbpra_isapplicable"] = true;
                svc.Create(si);
            }
            return template.ToEntityReference();
        }

        internal static void WriteEvent(IOrganizationService svc, EntityReference subRef, int eventType, string action, DateTime at, EntityReference actor, int actorKind,
            string relatedType, Guid relatedId, string oldStatus, string newStatus, string reason, int channel, string eventKey, string revision)
        {
            var e = new Entity("nbpra_businessevent");
            e["nbpra_name"] = action;
            e["nbpra_submission"] = subRef;
            e["nbpra_eventtype"] = new OptionSetValue(eventType);
            e["nbpra_action"] = action;
            e["nbpra_occurredat"] = at;
            if (actor != null) e["nbpra_actor"] = actor;
            e["nbpra_actorkind"] = new OptionSetValue(actorKind);
            e["nbpra_relatedrecordtype"] = relatedType;
            e["nbpra_relatedrecordid"] = relatedId.ToString();
            if (oldStatus != null) e["nbpra_oldstatus"] = oldStatus;
            if (newStatus != null) e["nbpra_newstatus"] = newStatus;
            e["nbpra_summary"] = revision;
            if (!string.IsNullOrEmpty(reason)) e["nbpra_reason"] = reason;
            e["nbpra_channel"] = new OptionSetValue(channel);
            e["nbpra_correlationid"] = eventKey;
            e["nbpra_eventkey"] = eventKey;
            svc.Create(e);
        }
    }
}
