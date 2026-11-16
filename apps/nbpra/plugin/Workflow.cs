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
    ///   setSignatory        TargetId = submission; Payload = {"seat":2-6,"name","email","directoryId","role"} (seat 1 is the sponsor)
    ///   sendSignatory       TargetId = signatory; marks the request Pending, which starts the approval flow
    ///   decideSignatory     TargetId = signatory; Outcome = approve | return; Payload = {"responder":email} when a flow reports it
    ///   finalSubmit         TargetId = submission
    ///   uploadEvidence      TargetId = section instance; Payload = {"q","fileName","contentType","base64"} -> Data: evidence id
    ///   downloadEvidence    TargetId = evidence -> Data: {"fileName","contentType","base64"}
    ///   saveExport          TargetId = submission; Payload = {"fileName","base64","exportType"} -> Data: export id
    ///   downloadExport      TargetId = export package -> Data: {"fileName","contentType","base64"}
    ///   copySubmission      TargetId = earlier submission -> Data: new submission id
    ///   postNote            TargetId = submission; Comment = the administrator's update for the submitter
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
            [DataMember(Name = "sponsor")] public PersonIn Sponsor;
        }

        [DataContract]
        private sealed class PersonIn
        {
            [DataMember(Name = "seat")] public int Seat;
            [DataMember(Name = "name")] public string Name;
            [DataMember(Name = "email")] public string Email;
            [DataMember(Name = "directoryId")] public string DirectoryId;
            [DataMember(Name = "role")] public string Role;
            [DataMember(Name = "responder")] public string Responder;
        }

        [DataContract]
        private sealed class AnswerIn
        {
            [DataMember(Name = "q")] public string Question;
            [DataMember(Name = "v")] public string Value;
        }

        [DataContract]
        private sealed class FileIn
        {
            [DataMember(Name = "q")] public string Question;
            [DataMember(Name = "fileName")] public string FileName;
            [DataMember(Name = "contentType")] public string ContentType;
            [DataMember(Name = "base64")] public string Base64;
            [DataMember(Name = "exportType")] public string ExportType;
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
                    case "setSignatory": data = SetSignatory(Id(target), payload).ToString(); message = "Signatory saved."; break;
                    case "sendSignatory": message = SendSignatory(Id(target)); break;
                    case "decideSignatory": message = DecideSignatory(Id(target), outcome, comment, payload); break;
                    case "finalSubmit": FinalSubmit(Id(target)); message = "Final submission made. Awaiting the NBPRA administrator."; break;
                    case "uploadEvidence": data = UploadEvidence(Id(target), payload); message = "File uploaded."; break;
                    case "downloadEvidence": data = DownloadFile("nbpra_evidence", Id(target)); break;
                    case "saveExport": data = SaveExport(Id(target), payload).ToString(); message = "Memo saved to the submission's export history."; break;
                    case "downloadExport": data = DownloadFile("nbpra_exportpackage", Id(target)); break;
                    case "postNote": PostNote(Id(target), comment); message = "Update posted to the submission."; break;
                    case "copySubmission": data = CopySubmission(Id(target)).ToString(); message = "New draft created from the earlier submission."; break;
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
            return "{\"userId\":\"" + actor + "\",\"fullName\":\"" + Js(u.GetAttributeValue<string>("fullname")) + "\",\"email\":\"" + Js(ActorEmail()) + "\",\"isAdmin\":" + (AdminDecision.IsAdmin(svc, actor) ? "true" : "false") + "}";
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

            // The business unit sponsor is the one signatory known at this point; the other
            // five are chosen by the submitter later, when each area's work is done.
            if (d.Sponsor != null && !string.IsNullOrWhiteSpace(d.Sponsor.Email))
            {
                d.Sponsor.Role = SponsorRole;
                SetSeat(id, 1, d.Sponsor);
            }
            return id;
        }

        private const string SponsorRole = "Business unit sponsor";
        private const int Seats = 6;

        private string ActorEmail() => (svc.Retrieve("systemuser", actor, new ColumnSet("internalemailaddress")).GetAttributeValue<string>("internalemailaddress") ?? string.Empty).Trim();
        private static bool SameEmail(string a, string b) => a != null && b != null && string.Equals(a.Trim(), b.Trim(), StringComparison.OrdinalIgnoreCase);

        private List<Entity> CurrentSeats(Guid submissionId) =>
            Rows("nbpra_signatory", new ColumnSet("nbpra_slotnumber", "nbpra_displayname", "nbpra_email", "nbpra_role", "nbpra_status", "nbpra_assignmentversion"), ("nbpra_submission", submissionId), ("nbpra_iscurrent", true));

        /// <summary>
        /// Names the person in one signatory seat. Changing a person who has already been
        /// asked keeps the earlier row as history and starts a new, unsent one.
        /// </summary>
        private Guid SetSeat(Guid submissionId, int n, PersonIn p)
        {
            var email = (p.Email ?? string.Empty).Trim();
            if (email.IndexOf('@') < 1) throw Invalid("Choose a person with an email address.");
            var name = string.IsNullOrWhiteSpace(p.Name) ? email : p.Name.Trim();
            var seats = CurrentSeats(submissionId);
            if (seats.Any(x => (x.GetAttributeValue<int?>("nbpra_slotnumber") ?? 0) != n && SameEmail(x.GetAttributeValue<string>("nbpra_email"), email)) && !AdminDecision.Flag(svc, "nbpra_AllowDuplicateSignatories"))
                throw Invalid(name + " is already a signatory on this submission. The six signatories must be six different people.");
            var owner = svc.Retrieve("nbpra_submission", submissionId, new ColumnSet("nbpra_businessowner")).GetAttributeValue<EntityReference>("nbpra_businessowner");
            if (owner != null && !AdminDecision.AllowSelfApproval(svc)
                && SameEmail(svc.Retrieve("systemuser", owner.Id, new ColumnSet("internalemailaddress")).GetAttributeValue<string>("internalemailaddress"), email))
                throw Invalid("The business owner cannot be a signatory on their own submission.");

            var seat = seats.FirstOrDefault(x => (x.GetAttributeValue<int?>("nbpra_slotnumber") ?? 0) == n);
            var version = 1;
            if (seat != null)
            {
                var samePerson = SameEmail(seat.GetAttributeValue<string>("nbpra_email"), email);
                if (samePerson || Opt(seat, "nbpra_status") == C.SignatoryStatus.NotSent)
                {
                    var keep = new Entity("nbpra_signatory", seat.Id);
                    keep["nbpra_displayname"] = name;
                    keep["nbpra_email"] = email;
                    keep["nbpra_directoryid"] = p.DirectoryId;
                    keep["nbpra_role"] = p.Role;
                    keep["nbpra_name"] = name + " · " + (string.IsNullOrWhiteSpace(p.Role) ? "Signatory " + n : p.Role);
                    svc.Update(keep);
                    return seat.Id;
                }
                var old = new Entity("nbpra_signatory", seat.Id);
                old["nbpra_iscurrent"] = false;
                old["nbpra_status"] = O(C.SignatoryStatus.Replaced);
                old["nbpra_replacedat"] = now;
                old["nbpra_replacementreason"] = "Replaced by the business owner.";
                svc.Update(old);
                version = (seat.GetAttributeValue<int?>("nbpra_assignmentversion") ?? 1) + 1;
            }
            var s = new Entity("nbpra_signatory");
            s["nbpra_name"] = name + " · " + (string.IsNullOrWhiteSpace(p.Role) ? "Signatory " + n : p.Role);
            s["nbpra_submission"] = new EntityReference("nbpra_submission", submissionId);
            s["nbpra_slotnumber"] = n;
            s["nbpra_assignmentversion"] = version;
            s["nbpra_iscurrent"] = true;
            s["nbpra_displayname"] = name;
            s["nbpra_email"] = email;
            s["nbpra_directoryid"] = p.DirectoryId;
            s["nbpra_role"] = p.Role;
            s["nbpra_status"] = O(C.SignatoryStatus.NotSent);
            s["nbpra_assignedat"] = now;
            s["nbpra_assignedby"] = actorRef;
            s["ownerid"] = owner ?? actorRef;
            return svc.Create(s);
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
            if (slotRef == null) missing.Add("requested committee meeting");
            if (!CurrentSeats(id).Any(x => (x.GetAttributeValue<int?>("nbpra_slotnumber") ?? 0) == 1)) missing.Add("business unit sponsor");

            if (missing.Count > 0) throw Invalid("Complete these before submitting: " + string.Join(", ", missing) + ".");

            var slot = svc.Retrieve("nbpra_slot", slotRef.Id, new ColumnSet("nbpra_status", "nbpra_meeting", "nbpra_capacity", "nbpra_activeallocationcount"));
            if (Opt(slot, "nbpra_status") != C.SlotStatus.Open) throw Invalid("That meeting can no longer be requested. Choose another.");
            // A meeting takes a fixed number of submissions. A place is taken only when the
            // administrator approves a request; requests still awaiting a decision do not hold one,
            // so approval is where a full meeting is finally enforced. A meeting that is already
            // full cannot be requested at all.
            var held = Rows("nbpra_slotrequest", new ColumnSet("nbpra_status", "nbpra_allocationactive"), ("nbpra_assignedslot", slotRef.Id))
                .Count(r => Opt(r, "nbpra_status") == C.SlotRequestStatus.Approved && r.GetAttributeValue<bool?>("nbpra_allocationactive") == true);
            if (held >= (slot.GetAttributeValue<int?>("nbpra_capacity") ?? 1)) throw Invalid("That meeting is full. Choose another meeting.");
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
                Js(sub.GetAttributeValue<string>("nbpra_proposaltype")) + "\",\"slot\":\"" + slotRef.Id + "\"}";
            svc.Update(sr);

            Touch(id, C.SubmissionStatus.AwaitingOnboardingReview, e => e["nbpra_currentslotrequest"] = draft.ToEntityReference());
            Event(subRef, C.EventType.Slot, "Onboarding submitted", C.SubmissionStatus.Label(st), "Awaiting Onboarding Review", null, "Onboarding rev " + rev,
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

        private List<Entity> Questions(Guid sectionDefId) => Sections.Questions(svc, sectionDefId);

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

            var revisionId = Sections.EnsureDraft(svc, inst, actorRef);
            var revRef = new EntityReference("nbpra_sectionrevision", revisionId);

            var existing = Rows("nbpra_answer", new ColumnSet("nbpra_questiondef"), ("nbpra_sectionrevision", revisionId))
                .ToDictionary(a => a.GetAttributeValue<EntityReference>("nbpra_questiondef").Id, a => a.Id);
            foreach (var a in answers ?? new List<AnswerIn>())
            {
                if (!Guid.TryParse(a.Question, out var qid)) continue;
                var q = questions.FirstOrDefault(x => x.Id == qid);
                if (q == null) throw Invalid("An answer refers to a question that is not in this section.");
                var type = Opt(q, "nbpra_answertype");
                if (type == C.AnswerType.File) continue; // answered by uploadEvidence
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

            var newStatus = Sections.Recompute(svc, instanceId, defId, revisionId);
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
            var unanswered = Sections.MissingRequired(svc, defId, revRef.Id);
            if (unanswered > 0) throw Invalid(unanswered + " required question(s) still need an answer or a file.");

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

        private static byte[] FromBase64(string b64)
        {
            try
            {
                return Convert.FromBase64String(b64 ?? string.Empty);
            }
            catch (FormatException)
            {
                throw Invalid("The file could not be read.");
            }
        }

        private static string Extension(string fileName)
        {
            var i = (fileName ?? string.Empty).LastIndexOf('.');
            return i < 0 ? string.Empty : fileName.Substring(i + 1).ToLowerInvariant();
        }

        private string UploadEvidence(Guid instanceId, string payload)
        {
            var f = Parse<FileIn>(payload);
            var (inst, sub) = LoadSection(instanceId);
            var status = Opt(inst, "nbpra_status");
            if (status == C.SectionStatus.UnderReview) throw Invalid("This section is under review and cannot be changed.");
            if (status == C.SectionStatus.Approved) throw Invalid("This section is approved. Reopening an approved section is not available yet.");
            var defId = inst.GetAttributeValue<EntityReference>("nbpra_sectiondef").Id;
            var q = Guid.TryParse(f.Question, out var qid) ? Questions(defId).FirstOrDefault(x => x.Id == qid) : null;
            if (q == null || Opt(q, "nbpra_answertype") != C.AnswerType.File) throw Invalid("That question does not take a file.");

            var name = (f.FileName ?? string.Empty).Trim();
            var ext = Extension(name);
            if (name.Length == 0 || name.Length > 200) throw Invalid("The file needs a name of up to 200 characters.");
            // FR-14 / NFR-06: only listed formats, checked on the server.
            var allowed = (q.GetAttributeValue<string>("nbpra_validationrule") ?? string.Empty).Split(new[] { ',', ' ' }, StringSplitOptions.RemoveEmptyEntries).Select(x => x.Trim('.').ToLowerInvariant()).ToArray();
            if (allowed.Length == 0) allowed = Sections.AllowedExtensions;
            if (!Sections.AllowedExtensions.Contains(ext) || !allowed.Contains(ext)) throw Invalid("This question needs a file of type: " + string.Join(", ", allowed) + ".");
            var bytes = FromBase64(f.Base64);
            if (bytes.Length == 0) throw Invalid("The file is empty.");
            if (bytes.Length > Sections.MaxFileBytes) throw Invalid("The file is larger than the " + (Sections.MaxFileBytes / 1024 / 1024) + " MB limit.");

            var revisionId = Sections.EnsureDraft(svc, inst, actorRef);
            // A replacement is a new version; the earlier file is kept and marked superseded.
            var previous = Sections.CurrentEvidence(svc, revisionId).Where(e => e.GetAttributeValue<EntityReference>("nbpra_questiondef")?.Id == qid).ToList();
            var version = previous.Count == 0 ? 1 : previous.Max(e => e.GetAttributeValue<int?>("nbpra_versionnumber") ?? 1) + 1;
            foreach (var old in previous)
            {
                var o = new Entity("nbpra_evidence", old.Id);
                o["nbpra_uploadstatus"] = O(C.UploadStatus.Superseded);
                svc.Update(o);
            }
            var id = Sections.StoreEvidence(svc, sub.ToEntityReference(), revisionId, q.ToEntityReference(), name, string.IsNullOrWhiteSpace(f.ContentType) ? "application/octet-stream" : f.ContentType,
                bytes, actorRef, version, previous.OrderByDescending(e => e.GetAttributeValue<int?>("nbpra_versionnumber") ?? 0).FirstOrDefault()?.ToEntityReference());
            Sections.Recompute(svc, instanceId, defId, revisionId);
            Touch(sub.Id);
            Event(sub.ToEntityReference(), C.EventType.Evidence, (version == 1 ? "Evidence uploaded: " : "Evidence replaced (version " + version + "): ") + name, null, null, null,
                inst.GetAttributeValue<string>("nbpra_name"), "nbpra_evidence", id, id.ToString("N") + ":uploaded");
            return id.ToString();
        }

        /// <summary>Who may read a submission's files: its owner, an administrator, a named signatory or a member of one of its review groups.</summary>
        private void RequireReader(Guid submissionId)
        {
            var sub = LoadSubmission(submissionId);
            if (sub.GetAttributeValue<EntityReference>("nbpra_businessowner")?.Id == actor || AdminDecision.IsAdmin(svc, actor)) return;
            var mine = ActorEmail();
            if (mine.Length > 0 && CurrentSeats(submissionId).Any(x => SameEmail(x.GetAttributeValue<string>("nbpra_email"), mine))) return;
            foreach (var team in Rows("nbpra_approvalrequest", new ColumnSet("nbpra_reviewteam"), ("nbpra_submission", submissionId)).Select(r => r.GetAttributeValue<EntityReference>("nbpra_reviewteam")).Where(t => t != null).Select(t => t.Id).Distinct())
                if (InTeam(team)) return;
            throw Denied("You do not have access to this submission's files.");
        }

        private string DownloadFile(string table, Guid id)
        {
            Entity row;
            try
            {
                row = svc.Retrieve(table, id, table == "nbpra_evidence" ? new ColumnSet("nbpra_submission", "nbpra_originalfilename", "nbpra_contenttype") : new ColumnSet("nbpra_submission", "nbpra_filename"));
            }
            catch (Exception)
            {
                throw Invalid("File not found.");
            }
            RequireReader(row.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            var bytes = Sections.Download(svc, row.ToEntityReference());
            var name = row.GetAttributeValue<string>(table == "nbpra_evidence" ? "nbpra_originalfilename" : "nbpra_filename");
            var type = table == "nbpra_evidence" ? row.GetAttributeValue<string>("nbpra_contenttype") : "application/pdf";
            return "{\"fileName\":\"" + Js(name) + "\",\"contentType\":\"" + Js(type) + "\",\"base64\":\"" + Convert.ToBase64String(bytes) + "\"}";
        }

        private Guid SaveExport(Guid submissionId, string payload)
        {
            var f = Parse<FileIn>(payload);
            var sub = LoadSubmission(submissionId);
            if (sub.GetAttributeValue<EntityReference>("nbpra_businessowner")?.Id != actor && !AdminDecision.IsAdmin(svc, actor))
                throw Denied("Only the business owner or an administrator can generate the memo.");
            var bytes = FromBase64(f.Base64);
            if (bytes.Length < 5 || bytes[0] != (byte)'%' || bytes[1] != (byte)'P' || bytes[2] != (byte)'D' || bytes[3] != (byte)'F') throw Invalid("The memo must be a PDF.");
            if (bytes.Length > Sections.MaxFileBytes) throw Invalid("The memo is larger than the " + (Sections.MaxFileBytes / 1024 / 1024) + " MB limit.");
            var st = Opt(sub, "nbpra_status");
            var type = st == C.SubmissionStatus.AuthorizedForCommittee ? C.ExportType.CommitteeAuthorized : st == C.SubmissionStatus.AwaitingFinalAdminReview ? C.ExportType.Submitted : C.ExportType.Draft;
            var name = string.IsNullOrWhiteSpace(f.FileName) ? "NBPRA memo.pdf" : f.FileName.Trim();

            var e = new Entity("nbpra_exportpackage");
            e["nbpra_name"] = name;
            e["nbpra_submission"] = sub.ToEntityReference();
            e["nbpra_packagerevision"] = sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0;
            e["nbpra_exporttype"] = O(type);
            e["nbpra_requestedby"] = actorRef;
            e["nbpra_requestedat"] = now;
            e["nbpra_generatedat"] = now;
            e["nbpra_status"] = O(C.ExportStatus.Pending);
            e["nbpra_filename"] = name;
            e["nbpra_sizebytes"] = (long)bytes.Length;
            e["nbpra_templateversion"] = "memo-1";
            e["ownerid"] = actorRef;
            var id = svc.Create(e);
            Sections.Upload(svc, new EntityReference("nbpra_exportpackage", id), "nbpra_file", name, "application/pdf", bytes);
            var done = new Entity("nbpra_exportpackage", id);
            done["nbpra_status"] = O(C.ExportStatus.Generated);
            svc.Update(done);
            Event(sub.ToEntityReference(), C.EventType.Export, "Committee memo generated (" + (type == C.ExportType.Draft ? "draft" : type == C.ExportType.Submitted ? "submitted package" : "committee-authorized") + ")", null, null, null,
                "Package rev " + (sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0), "nbpra_exportpackage", id, id.ToString("N") + ":generated");
            return id;
        }

        private void PostNote(Guid submissionId, string text)
        {
            if (!AdminDecision.IsAdmin(svc, actor)) throw Denied("Only an NBPRA Administrator can post an update.");
            if (text.Length == 0) throw Invalid("Write the update before posting it.");
            if (text.Length > 4000) throw Invalid("Keep the update under 4,000 characters.");
            var sub = LoadSubmission(submissionId);
            Touch(submissionId, null, e =>
            {
                e["nbpra_adminnote"] = text;
                e["nbpra_adminnoteat"] = now;
                e["nbpra_adminnoteby"] = actorRef;
            });
            // The box shows the latest update; every update stays in the timeline.
            Event(sub.ToEntityReference(), C.EventType.Notification, "Administrator posted an update", null, null, text, null, "nbpra_submission", submissionId, submissionId.ToString("N") + ":note:" + now.Ticks);
        }

        private Guid CopySubmission(Guid sourceId)
        {
            Entity src;
            try
            {
                src = svc.Retrieve("nbpra_submission", sourceId, new ColumnSet("nbpra_title", "nbpra_name", "nbpra_reference", "nbpra_businessowner", "nbpra_businessarea", "nbpra_proposaltype", "nbpra_summary", "nbpra_scope", "nbpra_sponsor"));
            }
            catch (Exception)
            {
                throw Invalid("Submission not found.");
            }
            if (src.GetAttributeValue<EntityReference>("nbpra_businessowner")?.Id != actor && !AdminDecision.IsAdmin(svc, actor))
                throw Denied("You can only start from one of your own submissions.");
            var title = "Copy of " + (src.GetAttributeValue<string>("nbpra_title") ?? src.GetAttributeValue<string>("nbpra_name"));
            if (title.Length > 200) title = title.Substring(0, 200);

            // Content only. Slot, signatories, approvals, files and history all start fresh.
            var sub = new Entity("nbpra_submission");
            sub["nbpra_status"] = O(C.SubmissionStatus.OnboardingDraft);
            sub["nbpra_packagerevision"] = 0;
            sub["nbpra_businessowner"] = actorRef;
            sub["ownerid"] = actorRef;
            sub["nbpra_name"] = title;
            sub["nbpra_title"] = title;
            foreach (var k in new[] { "nbpra_businessarea", "nbpra_proposaltype", "nbpra_summary", "nbpra_scope", "nbpra_sponsor" })
                if (src.Contains(k)) sub[k] = src[k];
            sub["nbpra_copiedfrom"] = src.ToEntityReference();
            sub["nbpra_lastbusinessactivityat"] = now;
            var id = svc.Create(sub);
            Event(new EntityReference("nbpra_submission", id), C.EventType.Submission, "Draft created from " + src.GetAttributeValue<string>("nbpra_reference"), null, "Onboarding Draft", null, null,
                "nbpra_submission", id, id.ToString("N") + ":created");
            return id;
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
                    message = Gate(sub.Id) ? name + " is approved. Every section and all six signatories are now approved." : name + " is approved.";
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

        private static bool SignatoryStage(int st) => st == C.SubmissionStatus.ChecklistInProgress || st == C.SubmissionStatus.AwaitingSignatoryApproval
            || st == C.SubmissionStatus.ReadyForFinalSubmission || st == C.SubmissionStatus.FinalChangesRequested;

        private Guid SetSignatory(Guid id, string payload)
        {
            var sub = LoadSubmission(id);
            RequireOwner(sub);
            if (!SignatoryStage(Opt(sub, "nbpra_status"))) throw Invalid("Signatories can be chosen once the checklist is open and before the final submission.");
            var p = Parse<PersonIn>(payload);
            if (p.Seat < 1 || p.Seat > Seats) throw Invalid("Choose one of the six signatory seats.");
            if (p.Seat == 1) p.Role = SponsorRole;
            var seatId = SetSeat(id, p.Seat, p);
            Gate(id);
            Touch(id);
            return seatId;
        }

        private Entity LoadSeat(Guid seatId)
        {
            Entity seat;
            try
            {
                seat = svc.Retrieve("nbpra_signatory", seatId, new ColumnSet("nbpra_submission", "nbpra_slotnumber", "nbpra_displayname", "nbpra_email", "nbpra_role", "nbpra_status", "nbpra_iscurrent"));
            }
            catch (Exception)
            {
                throw Invalid("Signatory not found.");
            }
            if (seat.GetAttributeValue<bool?>("nbpra_iscurrent") != true) throw Resolved("That signatory has since been replaced.");
            return seat;
        }

        private static string SeatLabel(Entity seat)
        {
            var role = seat.GetAttributeValue<string>("nbpra_role");
            return seat.GetAttributeValue<string>("nbpra_displayname") + (string.IsNullOrWhiteSpace(role) ? string.Empty : " (" + role + ")");
        }

        /// <summary>Marks one signatory's request Pending. A cloud flow watching for that sends the approval.</summary>
        private string SendSignatory(Guid seatId)
        {
            var seat = LoadSeat(seatId);
            var sub = LoadSubmission(seat.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            RequireOwner(sub);
            if (!SignatoryStage(Opt(sub, "nbpra_status"))) throw Invalid("Signatory approval cannot be requested at this stage.");
            var st = Opt(seat, "nbpra_status");
            if (st == C.SignatoryStatus.Pending) throw Resolved("The approval request has already been sent to " + seat.GetAttributeValue<string>("nbpra_displayname") + ".");
            if (st == C.SignatoryStatus.Approved) throw Resolved(seat.GetAttributeValue<string>("nbpra_displayname") + " has already approved.");

            var up = new Entity("nbpra_signatory", seatId);
            up["nbpra_status"] = O(C.SignatoryStatus.Pending);
            up["nbpra_requestedat"] = now;
            up["nbpra_decidedat"] = null;
            up["nbpra_decisioncomment"] = null;
            up["nbpra_decisionchannel"] = null;
            svc.Update(up);
            Touch(sub.Id);
            Event(sub.ToEntityReference(), C.EventType.Signatory, "Approval requested from " + SeatLabel(seat), null, null, null, null, "nbpra_signatory", seatId, seatId.ToString("N") + ":sent:" + now.Ticks);
            return "Approval request sent to " + seat.GetAttributeValue<string>("nbpra_displayname") + ".";
        }

        private bool HasRole(string roleName)
        {
            var q = new QueryExpression("role") { ColumnSet = new ColumnSet(false), TopCount = 1 };
            q.AddLink("systemuserroles", "roleid", "roleid").LinkCriteria.AddCondition("systemuserid", ConditionOperator.Equal, actor);
            q.Criteria.AddCondition("name", ConditionOperator.Equal, roleName);
            return svc.RetrieveMultiple(q).Entities.Any();
        }

        /// <summary>
        /// Records one signatory's answer. Three callers are accepted: the signatory
        /// (matched by email), the approval flow reporting who responded, and an
        /// administrator recording an answer received some other way.
        /// </summary>
        private string DecideSignatory(Guid seatId, string outcome, string comment, string payload)
        {
            if (outcome != "approve" && outcome != "return") throw Invalid("Choose Approve or Return.");
            var seat = LoadSeat(seatId);
            var st = Opt(seat, "nbpra_status");
            if (st == C.SignatoryStatus.Approved || st == C.SignatoryStatus.Returned) throw Resolved("This signatory's decision has already been recorded.");
            if (st != C.SignatoryStatus.Pending) throw Invalid("The approval request has not been sent to this signatory yet.");

            var email = seat.GetAttributeValue<string>("nbpra_email");
            var responder = string.IsNullOrWhiteSpace(payload) ? null : Parse<PersonIn>(payload).Responder;
            int channel;
            string by;
            if (!string.IsNullOrWhiteSpace(responder))
            {
                if (!AdminDecision.IsAdmin(svc, actor) && !HasRole("NBPRA Automation")) throw Denied("Only the approval flow can report a signatory's response.");
                if (!SameEmail(responder, email)) throw Denied("The response came from " + responder + ", who is not the named signatory.");
                channel = C.Channel.Flow;
                by = string.Empty;
            }
            else if (SameEmail(ActorEmail(), email))
            {
                channel = C.Channel.App;
                by = string.Empty;
            }
            else
            {
                if (!AdminDecision.IsAdmin(svc, actor)) throw Denied("Only the named signatory can record this decision.");
                if (comment.Length == 0) throw Invalid("Say how the signatory's answer was received before recording it for them.");
                channel = C.Channel.App;
                by = " (recorded by the administrator)";
            }
            if (outcome == "return" && comment.Length == 0) throw Invalid("Enter a reason before returning the package.");

            var sub = LoadSubmission(seat.GetAttributeValue<EntityReference>("nbpra_submission").Id);
            var approve = outcome == "approve";
            var up = new Entity("nbpra_signatory", seatId);
            up["nbpra_status"] = O(approve ? C.SignatoryStatus.Approved : C.SignatoryStatus.Returned);
            up["nbpra_decidedat"] = now;
            up["nbpra_decisioncomment"] = comment;
            up["nbpra_decisionchannel"] = O(channel);
            svc.Update(up);
            Touch(sub.Id);
            AdminDecision.WriteEvent(svc, sub.ToEntityReference(), C.EventType.Signatory, SeatLabel(seat) + (approve ? " approved" : " returned the package") + by, now,
                channel == C.Channel.Flow ? null : actorRef, channel == C.Channel.Flow ? C.ActorKind.System : C.ActorKind.Human, "nbpra_signatory", seatId,
                null, null, comment, channel, seatId.ToString("N") + ":" + outcome + ":" + now.Ticks, null);

            if (!approve) { Gate(sub.Id); return "The package was returned to the submitter by " + seat.GetAttributeValue<string>("nbpra_displayname") + "."; }
            var left = Seats - CurrentSeats(sub.Id).Count(x => Opt(x, "nbpra_status") == C.SignatoryStatus.Approved);
            return Gate(sub.Id) ? "All six signatories have approved and every section is approved. The package is ready for final submission."
                : left > 0 ? "Approval recorded. " + left + " signatory approval(s) still outstanding." : "Approval recorded. All six signatories have approved; sections are still open.";
        }

        private int OpenSections(Guid submissionId) =>
            Rows("nbpra_sectioninstance", new ColumnSet("nbpra_status", "nbpra_isapplicable"), ("nbpra_submission", submissionId))
                .Count(s => s.GetAttributeValue<bool?>("nbpra_isapplicable") != false && Opt(s, "nbpra_status") != C.SectionStatus.Approved && Opt(s, "nbpra_status") != C.SectionStatus.NotApplicable);

        private bool AllSigned(Guid submissionId)
        {
            var seats = CurrentSeats(submissionId);
            return Enumerable.Range(1, Seats).All(n => seats.Any(x => (x.GetAttributeValue<int?>("nbpra_slotnumber") ?? 0) == n && Opt(x, "nbpra_status") == C.SignatoryStatus.Approved));
        }

        /// <summary>
        /// Moves the submission between "in progress" and "ready for final submission" as
        /// sections and signatories complete, in whatever order. True when it is ready.
        /// </summary>
        private bool Gate(Guid submissionId)
        {
            var st = Opt(svc.Retrieve("nbpra_submission", submissionId, new ColumnSet("nbpra_status")), "nbpra_status");
            if (st != C.SubmissionStatus.ChecklistInProgress && st != C.SubmissionStatus.AwaitingSignatoryApproval && st != C.SubmissionStatus.ReadyForFinalSubmission) return false;
            var ready = OpenSections(submissionId) == 0 && AllSigned(submissionId);
            var subRef = new EntityReference("nbpra_submission", submissionId);
            if (ready && st != C.SubmissionStatus.ReadyForFinalSubmission)
            {
                Touch(submissionId, C.SubmissionStatus.ReadyForFinalSubmission);
                Event(subRef, C.EventType.Signatory, "Every section and all six signatories approved", C.SubmissionStatus.Label(st), "Ready for Final Submission", null, null, "nbpra_submission", submissionId, submissionId.ToString("N") + ":ready:" + now.Ticks, true);
            }
            else if (!ready && st == C.SubmissionStatus.ReadyForFinalSubmission)
            {
                Touch(submissionId, C.SubmissionStatus.ChecklistInProgress);
                Event(subRef, C.EventType.Invalidation, "No longer ready for final submission", "Ready for Final Submission", "Checklist in Progress", "A signatory was changed or returned the package.", null, "nbpra_submission", submissionId, submissionId.ToString("N") + ":unready:" + now.Ticks, true);
            }
            return ready;
        }

        private void FinalSubmit(Guid id)
        {
            var sub = LoadSubmission(id);
            RequireOwner(sub);
            var st = Opt(sub, "nbpra_status");
            if (st == C.SubmissionStatus.AwaitingFinalAdminReview) throw Resolved("The final submission has already been made.");
            if (st != C.SubmissionStatus.ReadyForFinalSubmission && st != C.SubmissionStatus.FinalChangesRequested) throw Invalid("Final submission needs every section approved and all six signatory approvals.");
            // FR-24: recheck the gates on the canonical records, not the status alone.
            var rev = (sub.GetAttributeValue<int?>("nbpra_packagerevision") ?? 0) + 1;
            if (!AllSigned(id)) throw Invalid("The six signatory approvals are not complete.");
            var notApproved = OpenSections(id);
            if (notApproved > 0) throw Invalid(notApproved + " section(s) are not approved.");
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
            Touch(id, C.SubmissionStatus.AwaitingFinalAdminReview, e => { e["nbpra_finalsubmittedat"] = now; e["nbpra_packagerevision"] = rev; });
            Event(subRef, C.EventType.FinalSubmission, "Final submission made", C.SubmissionStatus.Label(st), "Awaiting Final Admin Review", null, "Package rev " + rev, "nbpra_approvalrequest", reqId, reqId.ToString("N") + ":final");
        }
    }
}
