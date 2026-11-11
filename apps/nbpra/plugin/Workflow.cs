using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.Serialization;
using System.Runtime.Serialization.Json;
using System.Text;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using C = Nbpra.Plugins.Choices;

namespace Nbpra.Plugins
{
    /// <summary>
    /// Custom API nbpra_Workflow: every submitter, reviewer and signatory step
    /// before Kate's final decision (requirements FR-05 to FR-24, section 5.4).
    ///
    /// Inputs:  Operation, TargetId, Outcome, Comment, Payload (strings).
    /// Outputs: Outcome (accepted | already_resolved | unauthorized | validation_failed), Message, Data.
    ///
    /// Operations:
    ///   context             -> Data: {"userId","fullName","isAdmin"}
    ///   saveOnboarding      TargetId = submission (empty to create); Payload = intake JSON -> Data: submission id
    ///   submitOnboarding    TargetId = submission
    ///   saveSection         TargetId = section instance; Payload = [{"q":questionId,"v":value}]
    ///   submitSection       TargetId = section instance
    ///   decideReview        TargetId = approval request; Outcome = approve | changes
    ///   requestSignatories  TargetId = submission
    ///   decideSignatory     TargetId = approval assignment; Outcome = approve | return
    ///   finalSubmit         TargetId = submission
    ///
    /// Runs in the operation's transaction as SYSTEM, recording the human actor.
    /// Checks come before writes; a refused request writes nothing.
    /// </summary>
    public class Workflow : IPlugin
    {
        [DataContract]
        private sealed class Intake
        {
            [DataMember(Name = "title")] public string Title;
            [DataMember(Name = "businessArea")] public string BusinessArea;
            [DataMember(Name = "proposalType")] public string ProposalType;
            [DataMember(Name = "summary")] public string Summary;
            [DataMember(Name = "scope")] public string Scope;
            [DataMember(Name = "sponsorId")] public string SponsorId;
            [DataMember(Name = "slotId")] public string SlotId;
            [DataMember(Name = "signatories")] public List<string> Signatories;
        }

        [DataContract]
        private sealed class AnswerIn
        {
            [DataMember(Name = "q")] public string Question;
            [DataMember(Name = "v")] public string Value;
        }

        private sealed class Refused : Exception
        {
            public readonly string Outcome;
            public Refused(string outcome, string message) : base(message) { Outcome = outcome; }
        }

        private static Refused Invalid(string m) => new Refused("validation_failed", m);
        private static Refused Denied(string m) => new Refused("unauthorized", m);
        private static Refused Resolved(string m) => new Refused("already_resolved", m);

        private IOrganizationService svc;
        private Guid actor;
        private EntityReference actorRef;
        private DateTime now;

        public void Execute(IServiceProvider serviceProvider)
        {
            var ctx = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
            var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
            // A plug-in instance can be reused across calls, so per-call state is reset here.
            svc = factory.CreateOrganizationService(null);
            actor = ctx.InitiatingUserId;
            actorRef = new EntityReference("systemuser", actor);
            now = DateTime.UtcNow;

            string In(string name) => ctx.InputParameters.Contains(name) ? (ctx.InputParameters[name] as string ?? string.Empty).Trim() : string.Empty;
            var op = In("Operation");
            var target = In("TargetId");
            var outcome = In("Outcome").ToLowerInvariant();
            var comment = In("Comment");
            var payload = In("Payload");

            string message = "Done.", data = string.Empty, result = "accepted";
            try
            {
                switch (op)
                {
                    case "context": data = Context(); break;
                    case "saveOnboarding": data = SaveOnboarding(target, payload).ToString(); message = "Draft saved."; break;
                    case "submitOnboarding": SubmitOnboarding(Id(target)); message = "Onboarding request submitted to the NBPRA administrator."; break;
                    case "saveSection": data = SaveSection(Id(target), payload); message = "Section saved."; break;
                    case "submitSection": SubmitSection(Id(target)); message = "Section submitted for functional review."; break;
                    case "decideReview": message = DecideReview(Id(target), outcome, comment); break;
                    case "requestSignatories": RequestSignatories(Id(target)); message = "Package sent to the five signatories."; break;
                    case "decideSignatory": message = DecideSignatory(Id(target), outcome, comment); break;
                    case "finalSubmit": FinalSubmit(Id(target)); message = "Final submission made. Awaiting the NBPRA administrator."; break;
                    default: throw Invalid("Unknown operation.");
                }
            }
            catch (Refused r)
            {
                result = r.Outcome;
                message = r.Message;
            }
            ctx.OutputParameters["Outcome"] = result;
            ctx.OutputParameters["Message"] = message;
            ctx.OutputParameters["Data"] = data;
        }

        // ---- helpers ----------------------------------------------------------

        private static Guid Id(string s) => Guid.TryParse(s, out var g) ? g : throw Invalid("The record identifier is missing or not valid.");

        private static T Parse<T>(string json) where T : class
        {
            if (string.IsNullOrWhiteSpace(json)) throw Invalid("No data was sent.");
            try
            {
                using (var ms = new MemoryStream(Encoding.UTF8.GetBytes(json)))
                    return (T)new DataContractJsonSerializer(typeof(T)).ReadObject(ms);
            }
            catch (Exception)
            {
                throw Invalid("The data sent could not be read.");
            }
        }

        private static string Js(string s) => (s ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        private static int Opt(Entity e, string a) => e.GetAttributeValue<OptionSetValue>(a)?.Value ?? 0;
        private static OptionSetValue O(int v) => new OptionSetValue(v);

        private List<Entity> Rows(string table, ColumnSet cols, params (string attr, object value)[] where)
        {
            var q = new QueryExpression(table) { ColumnSet = cols };
            foreach (var (attr, value) in where) q.Criteria.AddCondition(attr, ConditionOperator.Equal, value);
            return svc.RetrieveMultiple(q).Entities.ToList();
        }

        private Entity LoadSubmission(Guid id)
        {
            try
            {
                return svc.Retrieve("nbpra_submission", id, new ColumnSet("nbpra_status", "nbpra_name", "nbpra_title", "nbpra_businessowner", "nbpra_businessarea",
                    "nbpra_proposaltype", "nbpra_summary", "nbpra_currentslotrequest", "nbpra_assignedslot", "nbpra_packagerevision"));
            }
            catch (Exception)
            {
                throw Invalid("Submission not found.");
            }
        }

        private void RequireOwner(Entity sub)
        {
            var owner = sub.GetAttributeValue<EntityReference>("nbpra_businessowner");
            if (owner?.Id != actor && !AdminDecision.IsAdmin(svc, actor)) throw Denied("Only the submission's business owner can do this.");
        }

        private void Event(EntityReference sub, int type, string action, string from, string to, string reason, string revision, string relatedType, Guid relatedId, string key, bool system = false)
        {
            AdminDecision.WriteEvent(svc, sub, type, action, now, system ? null : actorRef, system ? C.ActorKind.System : C.ActorKind.Human, relatedType, relatedId,
                from, to, reason, system ? C.Channel.System : C.Channel.App, key, revision);
        }

        private void Touch(Guid submissionId, int? status = null, Action<Entity> more = null)
        {
            var e = new Entity("nbpra_submission", submissionId);
            e["nbpra_lastbusinessactivityat"] = now;
            if (status.HasValue) e["nbpra_status"] = O(status.Value);
            more?.Invoke(e);
            svc.Update(e);
        }

        private bool InTeam(Guid teamId)
        {
            var q = new QueryExpression("teammembership") { ColumnSet = new ColumnSet(false), TopCount = 1 };
            q.Criteria.AddCondition("teamid", ConditionOperator.Equal, teamId);
            q.Criteria.AddCondition("systemuserid", ConditionOperator.Equal, actor);
            return svc.RetrieveMultiple(q).Entities.Any();
        }

        // ---- operations -------------------------------------------------------

        private string Context()
        {
            var u = svc.Retrieve("systemuser", actor, new ColumnSet("fullname"));
            return "{\"userId\":\"" + actor + "\",\"fullName\":\"" + Js(u.GetAttributeValue<string>("fullname")) + "\",\"isAdmin\":" + (AdminDecision.IsAdmin(svc, actor) ? "true" : "false") + "}";
        }

        private Guid SaveOnboarding(string target, string payload)
        {
            var d = Parse<Intake>(payload);
            var title = (d.Title ?? string.Empty).Trim();
            Guid id;
            Entity sub;
            if (string.IsNullOrEmpty(target))
            {
                sub = new Entity("nbpra_submission");
                sub["nbpra_status"] = O(C.SubmissionStatus.OnboardingDraft);
                sub["nbpra_packagerevision"] = 0;
                sub["nbpra_businessowner"] = actorRef;
                sub["ownerid"] = actorRef;
                sub["nbpra_name"] = title.Length > 0 ? title : "Untitled draft";
                id = svc.Create(sub);
                Event(new EntityReference("nbpra_submission", id), C.EventType.Submission, "Draft created", null, "Onboarding Draft", null, null, "nbpra_submission", id, id.ToString("N") + ":created");
            }
            else
            {
                id = Id(target);
                sub = LoadSubmission(id);
                RequireOwner(sub);
                var st = Opt(sub, "nbpra_status");
                if (st != C.SubmissionStatus.OnboardingDraft && st != C.SubmissionStatus.OnboardingDenied)
                    throw Resolved("Onboarding can only be edited while it is a draft or after it was denied.");
            }
            var subRef = new EntityReference("nbpra_submission", id);

            Touch(id, null, e =>
            {
                e["nbpra_name"] = title.Length > 0 ? title : "Untitled draft";
                e["nbpra_title"] = title;
                e["nbpra_businessarea"] = d.BusinessArea ?? string.Empty;
                e["nbpra_proposaltype"] = d.ProposalType ?? string.Empty;
                e["nbpra_summary"] = d.Summary ?? string.Empty;
                e["nbpra_scope"] = d.Scope ?? string.Empty;
                e["nbpra_sponsor"] = Guid.TryParse(d.SponsorId, out var sp) ? new EntityReference("systemuser", sp) : null;
            });

            // One editable draft request per submission; a denied request stays as history.
            var requests = Rows("nbpra_slotrequest", new ColumnSet("nbpra_status", "nbpra_revisionnumber"), ("nbpra_submission", id));
            var draft = requests.FirstOrDefault(r => Opt(r, "nbpra_status") == C.SlotRequestStatus.Draft);
            var slotRef = Guid.TryParse(d.SlotId, out var slotId) ? new EntityReference("nbpra_slot", slotId) : null;
            if (draft == null)
            {
                var previous = requests.OrderByDescending(r => r.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 0).FirstOrDefault();
                var rev = (previous?.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 0) + 1;
                var sr = new Entity("nbpra_slotrequest");
                sr["nbpra_name"] = (title.Length > 0 ? title : "Untitled draft") + " · onboarding rev " + rev;
                sr["nbpra_submission"] = subRef;
                sr["nbpra_revisionnumber"] = rev;
                sr["nbpra_status"] = O(C.SlotRequestStatus.Draft);
                sr["nbpra_allocationactive"] = false;
                sr["nbpra_requestedslot"] = slotRef;
                sr["ownerid"] = actorRef;
                if (previous != null) sr["nbpra_supersedes"] = previous.ToEntityReference();
                svc.Create(sr);
            }
            else
            {
                var sr = new Entity("nbpra_slotrequest", draft.Id);
                sr["nbpra_requestedslot"] = slotRef;
                svc.Update(sr);
            }

            var seats = Rows("nbpra_signatory", new ColumnSet("nbpra_slotnumber", "nbpra_person"), ("nbpra_submission", id), ("nbpra_iscurrent", true));
            for (var n = 1; n <= 5; n++)
            {
                var wanted = d.Signatories != null && d.Signatories.Count >= n && Guid.TryParse(d.Signatories[n - 1], out var pid) ? new EntityReference("systemuser", pid) : null;
                var seat = seats.FirstOrDefault(s => (s.GetAttributeValue<int?>("nbpra_slotnumber") ?? 0) == n);
                if (seat == null)
                {
                    var s = new Entity("nbpra_signatory");
                    s["nbpra_name"] = "Signatory " + n;
                    s["nbpra_submission"] = subRef;
                    s["nbpra_slotnumber"] = n;
                    s["nbpra_assignmentversion"] = 1;
                    s["nbpra_iscurrent"] = true;
                    s["nbpra_person"] = wanted;
                    s["nbpra_assignedat"] = now;
                    s["nbpra_assignedby"] = actorRef;
                    s["ownerid"] = actorRef;
                    svc.Create(s);
                }
                else if (seat.GetAttributeValue<EntityReference>("nbpra_person")?.Id != wanted?.Id)
                {
                    var s = new Entity("nbpra_signatory", seat.Id);
                    s["nbpra_person"] = wanted;
                    s["nbpra_assignedat"] = now;
                    s["nbpra_assignedby"] = actorRef;
                    svc.Update(s);
                }
            }
            return id;
        }

        private void SubmitOnboarding(Guid id)
        {
            var sub = LoadSubmission(id);
            RequireOwner(sub);
            var st = Opt(sub, "nbpra_status");
            if (st != C.SubmissionStatus.OnboardingDraft && st != C.SubmissionStatus.OnboardingDenied)
                throw Resolved("This onboarding request has already been submitted.");

            var missing = new List<string>();
            if (string.IsNullOrWhiteSpace(sub.GetAttributeValue<string>("nbpra_title"))) missing.Add("proposal title");
            if (string.IsNullOrWhiteSpace(sub.GetAttributeValue<string>("nbpra_businessarea"))) missing.Add("business area");
            if (string.IsNullOrWhiteSpace(sub.GetAttributeValue<string>("nbpra_proposaltype"))) missing.Add("proposal classification");
            if (string.IsNullOrWhiteSpace(sub.GetAttributeValue<string>("nbpra_summary"))) missing.Add("business description");

            var draft = Rows("nbpra_slotrequest", new ColumnSet("nbpra_status", "nbpra_revisionnumber", "nbpra_requestedslot"), ("nbpra_submission", id))
                .FirstOrDefault(r => Opt(r, "nbpra_status") == C.SlotRequestStatus.Draft);
            var slotRef = draft?.GetAttributeValue<EntityReference>("nbpra_requestedslot");
            if (slotRef == null) missing.Add("requested committee slot");

            var people = Rows("nbpra_signatory", new ColumnSet("nbpra_person"), ("nbpra_submission", id), ("nbpra_iscurrent", true))
                .Select(s => s.GetAttributeValue<EntityReference>("nbpra_person")?.Id).Where(p => p.HasValue).Select(p => p.Value).ToList();
            if (people.Count < 5) missing.Add("five signatories");
            if (missing.Count > 0) throw Invalid("Complete these before submitting: " + string.Join(", ", missing) + ".");
            if (people.Distinct().Count() < 5 && !AdminDecision.Flag(svc, "nbpra_AllowDuplicateSignatories"))
                throw Invalid("The five signatories must be five different people.");

            var slot = svc.Retrieve("nbpra_slot", slotRef.Id, new ColumnSet("nbpra_status", "nbpra_meeting"));
            if (Opt(slot, "nbpra_status") != C.SlotStatus.Open) throw Invalid("That slot can no longer be requested. Choose another.");
            var meetingRef = slot.GetAttributeValue<EntityReference>("nbpra_meeting");
            if (meetingRef != null)
            {
                var m = svc.Retrieve("nbpra_meeting", meetingRef.Id, new ColumnSet("nbpra_status", "nbpra_requestopenat", "nbpra_requestcloseat"));
                if (Opt(m, "nbpra_status") != C.MeetingStatus.Open) throw Invalid("That meeting is not open for requests. Choose another slot.");
                var open = m.GetAttributeValue<DateTime?>("nbpra_requestopenat");
                var close = m.GetAttributeValue<DateTime?>("nbpra_requestcloseat");
                if ((open.HasValue && now < open.Value) || (close.HasValue && now > close.Value)) throw Invalid("That meeting is outside its request window. Choose another slot.");
            }

            var subRef = sub.ToEntityReference();
            var rev = draft.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 1;
            var title = sub.GetAttributeValue<string>("nbpra_title");

            var req = new Entity("nbpra_approvalrequest");
            req["nbpra_name"] = "Onboarding: " + title;
            req["nbpra_submission"] = subRef;
            req["nbpra_purpose"] = O(C.ApprovalPurpose.Onboarding);
            req["nbpra_policy"] = O(C.ApprovalPolicy.OneAuthorized);
            req["nbpra_status"] = O(C.ApprovalStatus.Pending);
            req["nbpra_slotrequest"] = draft.ToEntityReference();
            req["nbpra_idempotencykey"] = id.ToString("N") + ":onboarding:" + draft.Id.ToString("N");
            var reqId = svc.Create(req);

            var sr = new Entity("nbpra_slotrequest", draft.Id);
            sr["nbpra_status"] = O(C.SlotRequestStatus.Pending);
            sr["nbpra_submittedat"] = now;
            sr["nbpra_submittedby"] = actorRef;
            sr["nbpra_decisionrequest"] = new EntityReference("nbpra_approvalrequest", reqId);
            sr["nbpra_intakesnapshot"] = "{\"title\":\"" + Js(title) + "\",\"businessArea\":\"" + Js(sub.GetAttributeValue<string>("nbpra_businessarea")) + "\",\"proposalType\":\"" +
                Js(sub.GetAttributeValue<string>("nbpra_proposaltype")) + "\",\"slot\":\"" + slotRef.Id + "\",\"signatories\":[" + string.Join(",", people.Select(p => "\"" + p + "\"")) + "]}";
            svc.Update(sr);

            Touch(id, C.SubmissionStatus.AwaitingOnboardingReview, e => e["nbpra_currentslotrequest"] = draft.ToEntityReference());
            Event(subRef, C.EventType.Slot, "Onboarding submitted with five signatories", C.SubmissionStatus.Label(st), "Awaiting Onboarding Review", null, "Onboarding rev " + rev,
                "nbpra_slotrequest", draft.Id, draft.Id.ToString("N") + ":submitted");
        }

        private (Entity instance, Entity sub) LoadSection(Guid instanceId)
        {
            Entity inst;
            try
            {
                inst = svc.Retrieve("nbpra_sectioninstance", instanceId, new ColumnSet("nbpra_submission", "nbpra_sectiondef", "nbpra_status", "nbpra_currentrevision", "nbpra_name", "nbpra_isapplicable"));
            }
            catch (Exception)
            {
                throw Invalid("Checklist section not found.");
            }
            var sub = LoadSubmission(inst.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            RequireOwner(sub);
            var st = Opt(sub, "nbpra_status");
            // FR-11: the checklist stays closed until onboarding is approved, whatever the client shows.
            if (st != C.SubmissionStatus.ChecklistInProgress && st != C.SubmissionStatus.FinalChangesRequested)
                throw Invalid("The checklist is not open for editing at this stage.");
            return (inst, sub);
        }

        private List<Entity> Questions(Guid sectionDefId) =>
            Rows("nbpra_questiondef", new ColumnSet("nbpra_code", "nbpra_label", "nbpra_answertype", "nbpra_isrequired"), ("nbpra_sectiondef", sectionDefId));

        private string SaveSection(Guid instanceId, string payload)
        {
            var answers = Parse<List<AnswerIn>>(payload);
            var (inst, sub) = LoadSection(instanceId);
            var status = Opt(inst, "nbpra_status");
            if (status == C.SectionStatus.UnderReview) throw Invalid("This section is under review and cannot be edited.");
            if (status == C.SectionStatus.Approved) throw Invalid("This section is approved. Reopening an approved section is not available yet.");

            var defId = inst.GetAttributeValue<EntityReference>("nbpra_sectiondef").Id;
            var questions = Questions(defId);
            var instRef = inst.ToEntityReference();

            // Reuse the open draft revision, or start a new one after a return.
            Entity revision = null;
            var currentRef = inst.GetAttributeValue<EntityReference>("nbpra_currentrevision");
            if (currentRef != null)
            {
                var cur = svc.Retrieve("nbpra_sectionrevision", currentRef.Id, new ColumnSet("nbpra_state", "nbpra_revisionnumber"));
                if (Opt(cur, "nbpra_state") == C.RevisionState.Draft) revision = cur;
            }
            if (revision == null)
            {
                var all = Rows("nbpra_sectionrevision", new ColumnSet("nbpra_revisionnumber"), ("nbpra_sectioninstance", instanceId));
                var number = (all.Max(r => r.GetAttributeValue<int?>("nbpra_revisionnumber")) ?? 0) + 1;
                revision = new Entity("nbpra_sectionrevision");
                revision["nbpra_name"] = inst.GetAttributeValue<string>("nbpra_name") + " · rev " + number;
                revision["nbpra_sectioninstance"] = instRef;
                revision["nbpra_revisionnumber"] = number;
                revision["nbpra_state"] = O(C.RevisionState.Draft);
                revision["ownerid"] = actorRef;
                if (currentRef != null) revision["nbpra_supersedes"] = currentRef;
                revision.Id = svc.Create(revision);
            }
            var revRef = new EntityReference("nbpra_sectionrevision", revision.Id);

            var existing = Rows("nbpra_answer", new ColumnSet("nbpra_questiondef"), ("nbpra_sectionrevision", revision.Id))
                .ToDictionary(a => a.GetAttributeValue<EntityReference>("nbpra_questiondef").Id, a => a.Id);
            var answered = new HashSet<Guid>();
            foreach (var a in answers ?? new List<AnswerIn>())
            {
                if (!Guid.TryParse(a.Question, out var qid)) continue;
                var q = questions.FirstOrDefault(x => x.Id == qid);
                if (q == null) throw Invalid("An answer refers to a question that is not in this section.");
                var type = Opt(q, "nbpra_answertype");
                var v = a.Value?.Trim();
                var has = !string.IsNullOrEmpty(v);

                var row = existing.TryGetValue(qid, out var rowId) ? new Entity("nbpra_answer", rowId) : new Entity("nbpra_answer");
                row["nbpra_isanswered"] = has;
                row["nbpra_isapplicable"] = true;
                row["nbpra_textvalue"] = null;
                row["nbpra_booleanvalue"] = null;
                row["nbpra_numbervalue"] = null;
                row["nbpra_datevalue"] = null;
                row["nbpra_optioncode"] = null;
                if (has)
                {
                    if (type == C.AnswerType.Boolean)
                    {
                        if (v != "true" && v != "false") throw Invalid("\"" + q.GetAttributeValue<string>("nbpra_label") + "\" needs Yes or No.");
                        row["nbpra_booleanvalue"] = v == "true";
                    }
                    else if (type == C.AnswerType.Number || type == C.AnswerType.Currency)
                    {
                        if (!decimal.TryParse(v, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var num))
                            throw Invalid("\"" + q.GetAttributeValue<string>("nbpra_label") + "\" needs a number.");
                        row["nbpra_numbervalue"] = num;
                    }
                    else if (type == C.AnswerType.Date)
                    {
                        if (!DateTime.TryParse(v, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var date))
                            throw Invalid("\"" + q.GetAttributeValue<string>("nbpra_label") + "\" needs a date.");
                        row["nbpra_datevalue"] = date.Date;
                    }
                    else if (type == C.AnswerType.Choice) row["nbpra_optioncode"] = v;
                    else row["nbpra_textvalue"] = v;
                    answered.Add(qid);
                }
                if (row.Id == Guid.Empty)
                {
                    row["nbpra_name"] = q.GetAttributeValue<string>("nbpra_code");
                    row["nbpra_sectionrevision"] = revRef;
                    row["nbpra_questiondef"] = q.ToEntityReference();
                    row["nbpra_answertype"] = O(type);
                    row["ownerid"] = actorRef;
                    existing[qid] = svc.Create(row);
                }
                else svc.Update(row);
            }

            // Questions not in this save keep their stored answer.
            var sent = new HashSet<Guid>((answers ?? new List<AnswerIn>()).Select(a => Guid.TryParse(a.Question, out var g) ? g : Guid.Empty));
            foreach (var kept in Rows("nbpra_answer", new ColumnSet("nbpra_questiondef", "nbpra_isanswered"), ("nbpra_sectionrevision", revision.Id)))
            {
                var qid = kept.GetAttributeValue<EntityReference>("nbpra_questiondef").Id;
                if (!sent.Contains(qid) && kept.GetAttributeValue<bool?>("nbpra_isanswered") == true) answered.Add(qid);
            }

            var complete = questions.Where(q => q.GetAttributeValue<bool?>("nbpra_isrequired") == true).All(q => answered.Contains(q.Id));
            var newStatus = complete ? C.SectionStatus.ReadyToSubmit : C.SectionStatus.Draft;
            var up = new Entity("nbpra_sectioninstance", instanceId);
            up["nbpra_status"] = O(newStatus);
            up["nbpra_currentrevision"] = revRef;
            svc.Update(up);
            Touch(sub.Id);
            return C.SectionStatus.Label(newStatus);
        }

        private void SubmitSection(Guid instanceId)
        {
            var (inst, sub) = LoadSection(instanceId);
            var status = Opt(inst, "nbpra_status");
            if (status == C.SectionStatus.UnderReview || status == C.SectionStatus.Approved) throw Resolved("This section has already been submitted.");
            var revRef = inst.GetAttributeValue<EntityReference>("nbpra_currentrevision");
            if (revRef == null) throw Invalid("Save the section's answers before submitting it.");
            var revision = svc.Retrieve("nbpra_sectionrevision", revRef.Id, new ColumnSet("nbpra_state", "nbpra_revisionnumber"));
            if (Opt(revision, "nbpra_state") != C.RevisionState.Draft) throw Resolved("This revision has already been submitted.");

            var defId = inst.GetAttributeValue<EntityReference>("nbpra_sectiondef").Id;
            var answered = Rows("nbpra_answer", new ColumnSet("nbpra_questiondef", "nbpra_isanswered"), ("nbpra_sectionrevision", revRef.Id))
                .Where(a => a.GetAttributeValue<bool?>("nbpra_isanswered") == true).Select(a => a.GetAttributeValue<EntityReference>("nbpra_questiondef").Id).ToList();
            var unanswered = Questions(defId).Where(q => q.GetAttributeValue<bool?>("nbpra_isrequired") == true && !answered.Contains(q.Id)).ToList();
            if (unanswered.Count > 0) throw Invalid(unanswered.Count + " required question(s) still need an answer.");

            // FR-17: a missing route or an empty group is an error, never an approval.
            var routes = Rows("nbpra_reviewroute", new ColumnSet("nbpra_reviewteam", "nbpra_completionpolicy"), ("nbpra_sectiondef", defId), ("nbpra_isactive", true));
            if (routes.Count == 0) throw Invalid("No review group is configured for this section. Ask the NBPRA administrator to set up its review route.");
            foreach (var route in routes)
            {
                var team = route.GetAttributeValue<EntityReference>("nbpra_reviewteam");
                var q = new QueryExpression("teammembership") { ColumnSet = new ColumnSet(false), TopCount = 1 };
                q.Criteria.AddCondition("teamid", ConditionOperator.Equal, team.Id);
                if (!svc.RetrieveMultiple(q).Entities.Any()) throw Invalid("A review group for this section has no members. Ask the NBPRA administrator to fix its membership.");
            }

            var subRef = sub.ToEntityReference();
            var number = revision.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 1;
            var name = inst.GetAttributeValue<string>("nbpra_name");
            foreach (var route in routes)
            {
                var team = route.GetAttributeValue<EntityReference>("nbpra_reviewteam");
                var req = new Entity("nbpra_approvalrequest");
                req["nbpra_name"] = name + " · rev " + number + " · " + sub.GetAttributeValue<string>("nbpra_name");
                req["nbpra_submission"] = subRef;
                req["nbpra_purpose"] = O(C.ApprovalPurpose.FunctionalSection);
                req["nbpra_policy"] = O(C.ApprovalPolicy.FirstResponse);
                req["nbpra_status"] = O(C.ApprovalStatus.Pending);
                req["nbpra_sectionrevision"] = revRef;
                req["nbpra_reviewteam"] = team;
                req["nbpra_idempotencykey"] = revRef.Id.ToString("N") + ":" + team.Id.ToString("N");
                svc.Create(req);
            }

            var rv = new Entity("nbpra_sectionrevision", revRef.Id);
            rv["nbpra_state"] = O(C.RevisionState.Submitted);
            rv["nbpra_submittedat"] = now;
            rv["nbpra_submittedby"] = actorRef;
            rv["nbpra_lockedat"] = now;
            svc.Update(rv);
            var up = new Entity("nbpra_sectioninstance", instanceId);
            up["nbpra_status"] = O(C.SectionStatus.UnderReview);
            up["nbpra_lastsubmittedat"] = now;
            svc.Update(up);
            Touch(sub.Id);
            Event(subRef, C.EventType.Section, name + " submitted for review", null, null, null, name + " rev " + number, "nbpra_sectionrevision", revRef.Id, revRef.Id.ToString("N") + ":submitted");
        }

        private Guid RecordDecision(Guid requestId, EntityReference signatorySeat, Guid? assignmentId, int outcome, string comment, string subject, string label)
        {
            var reqRef = new EntityReference("nbpra_approvalrequest", requestId);
            Guid aid;
            if (assignmentId.HasValue)
            {
                aid = assignmentId.Value;
                var a = new Entity("nbpra_approvalassignment", aid);
                a["nbpra_status"] = O(C.AssignmentStatus.Completed);
                svc.Update(a);
            }
            else
            {
                var a = new Entity("nbpra_approvalassignment");
                a["nbpra_name"] = label;
                a["nbpra_approvalrequest"] = reqRef;
                a["nbpra_assigneduser"] = actorRef;
                a["nbpra_assignedat"] = now;
                a["nbpra_status"] = O(C.AssignmentStatus.Completed);
                aid = svc.Create(a);
            }
            var d = new Entity("nbpra_approvaldecision");
            d["nbpra_name"] = label;
            d["nbpra_approvalrequest"] = reqRef;
            d["nbpra_assignment"] = new EntityReference("nbpra_approvalassignment", aid);
            d["nbpra_actor"] = actorRef;
            d["nbpra_outcome"] = O(outcome);
            d["nbpra_comment"] = comment;
            d["nbpra_decidedat"] = now;
            d["nbpra_channel"] = O(C.Channel.App);
            d["nbpra_correlationid"] = aid.ToString("N") + ":decision";
            d["nbpra_subjectrevisionreference"] = subject;
            svc.Create(d);
            return aid;
        }

        private void CloseRequest(Guid requestId, int status)
        {
            var r = new Entity("nbpra_approvalrequest", requestId);
            r["nbpra_status"] = O(status);
            r["nbpra_closedat"] = now;
            svc.Update(r);
        }

        private string DecideReview(Guid requestId, string outcome, string comment)
        {
            if (outcome != "approve" && outcome != "changes") throw Invalid("Choose Approve or Request changes.");
            Entity req;
            try
            {
                req = svc.Retrieve("nbpra_approvalrequest", requestId, new ColumnSet("nbpra_status", "nbpra_purpose", "nbpra_submission", "nbpra_sectionrevision", "nbpra_reviewteam"));
            }
            catch (Exception)
            {
                throw Invalid("Review request not found.");
            }
            if (Opt(req, "nbpra_purpose") != C.ApprovalPurpose.FunctionalSection) throw Invalid("That is not a functional review request.");
            if (Opt(req, "nbpra_status") != C.ApprovalStatus.Pending) throw Resolved("This review request has already been resolved.");
            var team = req.GetAttributeValue<EntityReference>("nbpra_reviewteam");
            if (team == null || !InTeam(team.Id)) throw Denied("You are not a member of the group this review is assigned to.");
            var sub = LoadSubmission(req.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            if (sub.GetAttributeValue<EntityReference>("nbpra_businessowner")?.Id == actor && !AdminDecision.AllowSelfApproval(svc))
                throw Denied("You cannot review your own submission. Another member of the group must act.");
            if (outcome == "changes" && comment.Length == 0) throw Invalid("Enter a reason before requesting changes.");

            var revRef = req.GetAttributeValue<EntityReference>("nbpra_sectionrevision");
            var revision = svc.Retrieve("nbpra_sectionrevision", revRef.Id, new ColumnSet("nbpra_sectioninstance", "nbpra_revisionnumber", "nbpra_state"));
            // FR-20: a late decision on an old revision must not touch the current one.
            if (Opt(revision, "nbpra_state") != C.RevisionState.Submitted) throw Resolved("That revision is no longer under review.");
            var instRef = revision.GetAttributeValue<EntityReference>("nbpra_sectioninstance");
            var inst = svc.Retrieve("nbpra_sectioninstance", instRef.Id, new ColumnSet("nbpra_name"));
            var name = inst.GetAttributeValue<string>("nbpra_name");
            var subject = name + " rev " + (revision.GetAttributeValue<int?>("nbpra_revisionnumber") ?? 1);
            var teamName = svc.Retrieve("team", team.Id, new ColumnSet("name")).GetAttributeValue<string>("name");
            var subRef = sub.ToEntityReference();
            var approve = outcome == "approve";

            RecordDecision(requestId, null, null, approve ? C.DecisionOutcome.Approve : C.DecisionOutcome.ChangesRequested, comment, subject, teamName + (approve ? " approved " : " returned ") + name);
            CloseRequest(requestId, approve ? C.ApprovalStatus.Approved : C.ApprovalStatus.ChangesRequested);

            var others = Rows("nbpra_approvalrequest", new ColumnSet("nbpra_status"), ("nbpra_sectionrevision", revRef.Id)).Where(r => r.Id != requestId).ToList();
            var instUp = new Entity("nbpra_sectioninstance", instRef.Id);
            var revUp = new Entity("nbpra_sectionrevision", revRef.Id);
            string message;
            if (approve)
            {
                if (others.All(r => Opt(r, "nbpra_status") == C.ApprovalStatus.Approved))
                {
                    revUp["nbpra_state"] = O(C.RevisionState.Approved);
                    svc.Update(revUp);
                    instUp["nbpra_status"] = O(C.SectionStatus.Approved);
                    instUp["nbpra_approvedrevision"] = revRef;
                    instUp["nbpra_approvedat"] = now;
                    svc.Update(instUp);
                    message = name + " is approved.";
                }
                else message = "Approval recorded. Other groups still need to review " + name + ".";
            }
            else
            {
                foreach (var o in others.Where(r => Opt(r, "nbpra_status") == C.ApprovalStatus.Pending)) CloseRequest(o.Id, C.ApprovalStatus.Superseded);
                revUp["nbpra_state"] = O(C.RevisionState.Returned);
                svc.Update(revUp);
                instUp["nbpra_status"] = O(C.SectionStatus.ChangesRequested);
                svc.Update(instUp);
                message = name + " was returned to the submitter.";
            }
            Touch(sub.Id);
            Event(subRef, C.EventType.ReviewRequest, teamName + (approve ? " approved " : " requested changes to ") + name, null, null, comment, subject, "nbpra_approvalrequest", requestId, requestId.ToString("N") + ":" + outcome);
            return message;
        }

        private void RequestSignatories(Guid id)
        {
            var sub = LoadSubmission(id);
            RequireOwner(sub);
            var st = Opt(sub, "nbpra_status");
            if (st == C.SubmissionStatus.AwaitingSignatoryApproval) throw Resolved("The package is already with the signatories.");
            if (st != C.SubmissionStatus.ChecklistInProgress && st != C.SubmissionStatus.FinalChangesRequested) throw Invalid("Signatory approval cannot be requested at this stage.");

            var sections = Rows("nbpra_sectioninstance", new ColumnSet("nbpra_status", "nbpra_isapplicable", "nbpra_name"), ("nbpra_submission", id))
                .Where(s => s.GetAttributeValue<bool?>("nbpra_isapplicable") != false && Opt(s, "nbpra_status") != C.SectionStatus.NotApplicable).ToList();
            if (sections.Count == 0) throw Invalid("This submission has no checklist sections.");
            var open = sections.Where(s => Opt(s, "nbpra_status") != C.SectionStatus.Approved).ToList();
            if (open.Count > 0) throw Invalid(open.Count + " section(s) are not yet approved: " + string.Join(", ", open.Take(4).Select(s => s.GetAttributeValue<string>("nbpra_name"))) + (open.Count > 4 ? "…" : "") + ".");

            var seats = Rows("nbpra_signatory", new ColumnSet("nbpra_person", "nbpra_slotnumber"), ("nbpra_submission", id), ("nbpra_iscurrent", true))
                .Where(s => s.GetAttributeValue<EntityReference>("nbpra_person") != null).OrderBy(s => s.GetAttributeValue<int?>("nbpra_slotnumber")).ToList();
            if (seats.Count != 5) throw Invalid("Five signatories must be assigned before requesting approval.");
            if (seats.Select(s => s.GetAttributeValue<EntityReference>("nbpra_person").Id).Distinct().Count() < 5 && !AdminDecision.Flag(svc, "nbpra_AllowDuplicateSignatories"))
                throw Invalid("The five signatories must be five different people.");

            var subRef = sub.ToEntityReference();
            var rev = (sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0) + 1;
            var req = new Entity("nbpra_approvalrequest");
            req["nbpra_name"] = "Signatory package rev " + rev + ": " + sub.GetAttributeValue<string>("nbpra_name");
            req["nbpra_submission"] = subRef;
            req["nbpra_purpose"] = O(C.ApprovalPurpose.SignatoryPackage);
            req["nbpra_policy"] = O(C.ApprovalPolicy.AllFiveNamed);
            req["nbpra_status"] = O(C.ApprovalStatus.Pending);
            req["nbpra_packagerevision"] = rev;
            req["nbpra_idempotencykey"] = id.ToString("N") + ":signatory:" + rev;
            var reqId = svc.Create(req);
            foreach (var seat in seats)
            {
                var a = new Entity("nbpra_approvalassignment");
                a["nbpra_name"] = "Signatory " + seat.GetAttributeValue<int?>("nbpra_slotnumber");
                a["nbpra_approvalrequest"] = new EntityReference("nbpra_approvalrequest", reqId);
                a["nbpra_assigneduser"] = seat.GetAttributeValue<EntityReference>("nbpra_person");
                a["nbpra_signatoryassignment"] = seat.ToEntityReference();
                a["nbpra_assignedat"] = now;
                a["nbpra_status"] = O(C.AssignmentStatus.Pending);
                svc.Create(a);
            }
            Touch(id, C.SubmissionStatus.AwaitingSignatoryApproval, e => e["nbpra_packagerevision"] = rev);
            Event(subRef, C.EventType.Signatory, "Package sent to five signatories", C.SubmissionStatus.Label(st), "Awaiting Signatory Approval", null, "Package rev " + rev, "nbpra_approvalrequest", reqId, reqId.ToString("N") + ":requested");
        }

        private string DecideSignatory(Guid assignmentId, string outcome, string comment)
        {
            if (outcome != "approve" && outcome != "return") throw Invalid("Choose Approve or Return.");
            Entity a;
            try
            {
                a = svc.Retrieve("nbpra_approvalassignment", assignmentId, new ColumnSet("nbpra_status", "nbpra_assigneduser", "nbpra_approvalrequest", "nbpra_signatoryassignment", "nbpra_name"));
            }
            catch (Exception)
            {
                throw Invalid("Signatory assignment not found.");
            }
            if (Opt(a, "nbpra_status") != C.AssignmentStatus.Pending) throw Resolved("This signatory decision has already been recorded or is no longer needed.");
            // FR-22: nobody, including an administrator, signs in another person's name.
            if (a.GetAttributeValue<EntityReference>("nbpra_assigneduser")?.Id != actor) throw Denied("Only the named signatory can record this decision.");
            var reqRef = a.GetAttributeValue<EntityReference>("nbpra_approvalrequest");
            var req = svc.Retrieve("nbpra_approvalrequest", reqRef.Id, new ColumnSet("nbpra_status", "nbpra_purpose", "nbpra_submission", "nbpra_packagerevision"));
            if (Opt(req, "nbpra_purpose") != C.ApprovalPurpose.SignatoryPackage || Opt(req, "nbpra_status") != C.ApprovalStatus.Pending)
                throw Resolved("This signatory request is no longer open.");
            if (outcome == "return" && comment.Length == 0) throw Invalid("Enter a reason before returning the package.");

            var sub = LoadSubmission(req.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            var subRef = sub.ToEntityReference();
            var subject = "Package rev " + (req.GetAttributeValue<int?>("nbpra_packagerevision") ?? 1);
            var seatName = a.GetAttributeValue<string>("nbpra_name");
            var approve = outcome == "approve";
            RecordDecision(reqRef.Id, null, assignmentId, approve ? C.DecisionOutcome.Approve : C.DecisionOutcome.ChangesRequested, comment, subject, seatName + (approve ? " approved" : " returned the package"));
            Event(subRef, C.EventType.Signatory, seatName + (approve ? " approved" : " returned the package"), null, null, comment, subject, "nbpra_approvalassignment", assignmentId, assignmentId.ToString("N") + ":" + outcome);

            var rest = Rows("nbpra_approvalassignment", new ColumnSet("nbpra_status"), ("nbpra_approvalrequest", reqRef.Id)).Where(x => x.Id != assignmentId).ToList();
            if (!approve)
            {
                foreach (var p in rest.Where(x => Opt(x, "nbpra_status") == C.AssignmentStatus.Pending))
                {
                    var c = new Entity("nbpra_approvalassignment", p.Id);
                    c["nbpra_status"] = O(C.AssignmentStatus.Canceled);
                    svc.Update(c);
                }
                CloseRequest(reqRef.Id, C.ApprovalStatus.ChangesRequested);
                Touch(sub.Id, C.SubmissionStatus.ChecklistInProgress);
                Event(subRef, C.EventType.Invalidation, "Signatory approvals invalidated", "Awaiting Signatory Approval", "Checklist in Progress", "A signatory returned the package.", subject,
                    "nbpra_approvalrequest", reqRef.Id, reqRef.Id.ToString("N") + ":invalidated", true);
                return "The package was returned to the submitter.";
            }
            var pending = rest.Count(x => Opt(x, "nbpra_status") == C.AssignmentStatus.Pending);
            if (pending > 0)
            {
                Touch(sub.Id);
                return "Approval recorded. " + pending + " signatory approval(s) still outstanding.";
            }
            CloseRequest(reqRef.Id, C.ApprovalStatus.Approved);
            Touch(sub.Id, C.SubmissionStatus.ReadyForFinalSubmission);
            Event(subRef, C.EventType.Signatory, "All five signatories approved", "Awaiting Signatory Approval", "Ready for Final Submission", null, subject, "nbpra_approvalrequest", reqRef.Id, reqRef.Id.ToString("N") + ":complete", true);
            return "All five signatories have approved. The package is ready for final submission.";
        }

        private void FinalSubmit(Guid id)
        {
            var sub = LoadSubmission(id);
            RequireOwner(sub);
            var st = Opt(sub, "nbpra_status");
            if (st == C.SubmissionStatus.AwaitingFinalAdminReview) throw Resolved("The final submission has already been made.");
            if (st != C.SubmissionStatus.ReadyForFinalSubmission) throw Invalid("Final submission needs every section approved and all five signatory approvals.");
            // FR-24: recheck the gates on the canonical records, not the status alone.
            var rev = sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0;
            var sig = Rows("nbpra_approvalrequest", new ColumnSet("nbpra_status", "nbpra_packagerevision"), ("nbpra_submission", id), ("nbpra_purpose", C.ApprovalPurpose.SignatoryPackage))
                .FirstOrDefault(r => (r.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0) == rev);
            if (sig == null || Opt(sig, "nbpra_status") != C.ApprovalStatus.Approved) throw Invalid("The five signatory approvals for the current package are not complete.");
            var notApproved = Rows("nbpra_sectioninstance", new ColumnSet("nbpra_status", "nbpra_isapplicable"), ("nbpra_submission", id))
                .Count(s => s.GetAttributeValue<bool?>("nbpra_isapplicable") != false && Opt(s, "nbpra_status") != C.SectionStatus.Approved && Opt(s, "nbpra_status") != C.SectionStatus.NotApplicable);
            if (notApproved > 0) throw Invalid(notApproved + " section(s) are no longer approved.");
            if (sub.GetAttributeValue<EntityReference>("nbpra_assignedslot") == null) throw Invalid("The submission has no confirmed committee slot.");

            var subRef = sub.ToEntityReference();
            var req = new Entity("nbpra_approvalrequest");
            req["nbpra_name"] = "Committee admission: " + sub.GetAttributeValue<string>("nbpra_name");
            req["nbpra_submission"] = subRef;
            req["nbpra_purpose"] = O(C.ApprovalPurpose.FinalCommitteeAdmission);
            req["nbpra_policy"] = O(C.ApprovalPolicy.OneAuthorized);
            req["nbpra_status"] = O(C.ApprovalStatus.Pending);
            req["nbpra_packagerevision"] = rev;
            req["nbpra_idempotencykey"] = id.ToString("N") + ":final:" + rev;
            var reqId = svc.Create(req);
            Touch(id, C.SubmissionStatus.AwaitingFinalAdminReview, e => e["nbpra_finalsubmittedat"] = now);
            Event(subRef, C.EventType.FinalSubmission, "Final submission made", "Ready for Final Submission", "Awaiting Final Admin Review", null, "Package rev " + rev, "nbpra_approvalrequest", reqId, reqId.ToString("N") + ":final");
        }
    }
}
