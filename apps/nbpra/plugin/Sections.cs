using System;
using System.Collections.Generic;
using System.Linq;
using Microsoft.Crm.Sdk.Messages;
using Microsoft.Xrm.Sdk;
using Microsoft.Xrm.Sdk.Query;
using C = Nbpra.Plugins.Choices;

namespace Nbpra.Plugins
{
    /// <summary>Checklist section, answer and evidence helpers shared by the custom APIs.</summary>
    internal static class Sections
    {
        internal const int MaxFileBytes = 5 * 1024 * 1024;
        internal static readonly string[] AllowedExtensions = { "pdf", "docx", "xlsx", "xls", "pptx", "png", "jpg", "jpeg", "csv" };

        internal static List<Entity> Rows(IOrganizationService svc, string table, ColumnSet cols, params (string attr, object value)[] where)
        {
            var q = new QueryExpression(table) { ColumnSet = cols };
            foreach (var (attr, value) in where) q.Criteria.AddCondition(attr, ConditionOperator.Equal, value);
            return svc.RetrieveMultiple(q).Entities.ToList();
        }

        internal static List<Entity> Questions(IOrganizationService svc, Guid sectionDefId) =>
            Rows(svc, "nbpra_questiondef", new ColumnSet("nbpra_code", "nbpra_label", "nbpra_answertype", "nbpra_isrequired", "nbpra_validationrule"), ("nbpra_sectiondef", sectionDefId));

        /// <summary>Evidence that currently counts for a revision: uploaded and not replaced.</summary>
        internal static List<Entity> CurrentEvidence(IOrganizationService svc, Guid revisionId) =>
            Rows(svc, "nbpra_evidence", new ColumnSet("nbpra_questiondef", "nbpra_originalfilename", "nbpra_contenttype", "nbpra_sizebytes", "nbpra_versionnumber", "nbpra_uploadstatus", "nbpra_submission"),
                ("nbpra_sectionrevision", revisionId), ("nbpra_uploadstatus", C.UploadStatus.Complete));

        /// <summary>Questions that count as answered on a revision. A file question is answered by an uploaded file.</summary>
        internal static HashSet<Guid> Answered(IOrganizationService svc, Guid revisionId)
        {
            var done = new HashSet<Guid>(Rows(svc, "nbpra_answer", new ColumnSet("nbpra_questiondef", "nbpra_isanswered"), ("nbpra_sectionrevision", revisionId))
                .Where(a => a.GetAttributeValue<bool?>("nbpra_isanswered") == true).Select(a => a.GetAttributeValue<EntityReference>("nbpra_questiondef").Id));
            foreach (var e in CurrentEvidence(svc, revisionId))
            {
                var q = e.GetAttributeValue<EntityReference>("nbpra_questiondef");
                if (q != null) done.Add(q.Id);
            }
            return done;
        }

        internal static int MissingRequired(IOrganizationService svc, Guid sectionDefId, Guid revisionId)
        {
            var done = Answered(svc, revisionId);
            return Questions(svc, sectionDefId).Count(q => q.GetAttributeValue<bool?>("nbpra_isrequired") == true && !done.Contains(q.Id));
        }

        /// <summary>Sets the section to Ready to Submit or Draft from what is stored, and returns the new status.</summary>
        internal static int Recompute(IOrganizationService svc, Guid instanceId, Guid sectionDefId, Guid revisionId)
        {
            var status = MissingRequired(svc, sectionDefId, revisionId) == 0 ? C.SectionStatus.ReadyToSubmit : C.SectionStatus.Draft;
            var up = new Entity("nbpra_sectioninstance", instanceId);
            up["nbpra_status"] = new OptionSetValue(status);
            up["nbpra_currentrevision"] = new EntityReference("nbpra_sectionrevision", revisionId);
            svc.Update(up);
            return status;
        }

        /// <summary>
        /// The section's open draft revision, creating one if needed. A revision
        /// started after a return carries the returned revision's files forward.
        /// </summary>
        internal static Guid EnsureDraft(IOrganizationService svc, Entity inst, EntityReference owner)
        {
            var currentRef = inst.GetAttributeValue<EntityReference>("nbpra_currentrevision");
            if (currentRef != null)
            {
                var cur = svc.Retrieve("nbpra_sectionrevision", currentRef.Id, new ColumnSet("nbpra_state"));
                if ((cur.GetAttributeValue<OptionSetValue>("nbpra_state")?.Value ?? 0) == C.RevisionState.Draft) return cur.Id;
            }
            var all = Rows(svc, "nbpra_sectionrevision", new ColumnSet("nbpra_revisionnumber"), ("nbpra_sectioninstance", inst.Id));
            var number = (all.Max(r => r.GetAttributeValue<int?>("nbpra_revisionnumber")) ?? 0) + 1;
            var revision = new Entity("nbpra_sectionrevision");
            revision["nbpra_name"] = inst.GetAttributeValue<string>("nbpra_name") + " · rev " + number;
            revision["nbpra_sectioninstance"] = inst.ToEntityReference();
            revision["nbpra_revisionnumber"] = number;
            revision["nbpra_state"] = new OptionSetValue(C.RevisionState.Draft);
            revision["ownerid"] = owner;
            if (currentRef != null) revision["nbpra_supersedes"] = currentRef;
            var id = svc.Create(revision);
            if (currentRef != null)
            {
                foreach (var e in CurrentEvidence(svc, currentRef.Id))
                {
                    var bytes = Download(svc, e.ToEntityReference());
                    StoreEvidence(svc, e.GetAttributeValue<EntityReference>("nbpra_submission"), id, e.GetAttributeValue<EntityReference>("nbpra_questiondef"),
                        e.GetAttributeValue<string>("nbpra_originalfilename"), e.GetAttributeValue<string>("nbpra_contenttype"), bytes, owner, e.GetAttributeValue<int?>("nbpra_versionnumber") ?? 1, e.ToEntityReference());
                }
            }
            return id;
        }

        internal static Guid StoreEvidence(IOrganizationService svc, EntityReference submission, Guid revisionId, EntityReference question, string fileName, string contentType, byte[] bytes, EntityReference owner, int version, EntityReference supersedes)
        {
            var e = new Entity("nbpra_evidence");
            e["nbpra_name"] = fileName;
            e["nbpra_submission"] = submission;
            e["nbpra_sectionrevision"] = new EntityReference("nbpra_sectionrevision", revisionId);
            if (question != null) e["nbpra_questiondef"] = question;
            e["nbpra_originalfilename"] = fileName;
            e["nbpra_contenttype"] = contentType;
            e["nbpra_sizebytes"] = (long)bytes.Length;
            e["nbpra_versionnumber"] = version;
            if (supersedes != null) e["nbpra_supersedes"] = supersedes;
            e["nbpra_uploadedat"] = DateTime.UtcNow;
            e["nbpra_uploadedby"] = owner;
            e["nbpra_uploadstatus"] = new OptionSetValue(C.UploadStatus.Pending);
            e["ownerid"] = owner;
            var id = svc.Create(e);
            Upload(svc, new EntityReference("nbpra_evidence", id), "nbpra_file", fileName, contentType, bytes);
            var done = new Entity("nbpra_evidence", id);
            done["nbpra_uploadstatus"] = new OptionSetValue(C.UploadStatus.Complete);
            svc.Update(done);
            return id;
        }

        internal static void Upload(IOrganizationService svc, EntityReference target, string column, string fileName, string contentType, byte[] bytes)
        {
            var init = (InitializeFileBlocksUploadResponse)svc.Execute(new InitializeFileBlocksUploadRequest { Target = target, FileAttributeName = column, FileName = fileName });
            const int block = 4 * 1024 * 1024;
            var ids = new List<string>();
            for (var offset = 0; offset < bytes.Length || ids.Count == 0; offset += block)
            {
                var size = Math.Min(block, bytes.Length - offset);
                var chunk = new byte[Math.Max(size, 0)];
                if (size > 0) Buffer.BlockCopy(bytes, offset, chunk, 0, size);
                var id = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(Guid.NewGuid().ToString()));
                svc.Execute(new UploadBlockRequest { BlockData = chunk, BlockId = id, FileContinuationToken = init.FileContinuationToken });
                ids.Add(id);
                if (size <= 0) break;
            }
            svc.Execute(new CommitFileBlocksUploadRequest { BlockList = ids.ToArray(), FileContinuationToken = init.FileContinuationToken, FileName = fileName, MimeType = contentType });
        }

        internal static byte[] Download(IOrganizationService svc, EntityReference target, string column = "nbpra_file")
        {
            var init = (InitializeFileBlocksDownloadResponse)svc.Execute(new InitializeFileBlocksDownloadRequest { Target = target, FileAttributeName = column });
            var data = new byte[init.FileSizeInBytes];
            const long block = 4 * 1024 * 1024;
            for (long offset = 0; offset < init.FileSizeInBytes; offset += block)
            {
                var r = (DownloadBlockResponse)svc.Execute(new DownloadBlockRequest { Offset = offset, BlockLength = block, FileContinuationToken = init.FileContinuationToken });
                Buffer.BlockCopy(r.Data, 0, data, (int)offset, r.Data.Length);
            }
            return data;
        }

        /// <summary>
        /// For a submission started from an earlier one: gives each new section a
        /// draft revision holding the earlier section's answers. Files, approvals
        /// and signatories are never copied.
        /// </summary>
        internal static void Prefill(IOrganizationService svc, Guid newSubmissionId, Guid sourceSubmissionId, EntityReference owner)
        {
            var source = Rows(svc, "nbpra_sectioninstance", new ColumnSet("nbpra_sectiondef", "nbpra_approvedrevision", "nbpra_currentrevision"), ("nbpra_submission", sourceSubmissionId));
            foreach (var inst in Rows(svc, "nbpra_sectioninstance", new ColumnSet("nbpra_sectiondef", "nbpra_name", "nbpra_currentrevision"), ("nbpra_submission", newSubmissionId)))
            {
                var defId = inst.GetAttributeValue<EntityReference>("nbpra_sectiondef").Id;
                var from = source.FirstOrDefault(s => s.GetAttributeValue<EntityReference>("nbpra_sectiondef")?.Id == defId);
                var fromRev = from?.GetAttributeValue<EntityReference>("nbpra_approvedrevision") ?? from?.GetAttributeValue<EntityReference>("nbpra_currentrevision");
                if (fromRev == null || inst.GetAttributeValue<EntityReference>("nbpra_currentrevision") != null) continue;
                var answers = Rows(svc, "nbpra_answer", new ColumnSet(true), ("nbpra_sectionrevision", fromRev.Id)).Where(a => a.GetAttributeValue<bool?>("nbpra_isanswered") == true).ToList();
                if (answers.Count == 0) continue;
                var revId = EnsureDraft(svc, inst, owner);
                foreach (var a in answers)
                {
                    var copy = new Entity("nbpra_answer");
                    foreach (var k in new[] { "nbpra_name", "nbpra_questiondef", "nbpra_answertype", "nbpra_textvalue", "nbpra_booleanvalue", "nbpra_numbervalue", "nbpra_datevalue", "nbpra_optioncode", "nbpra_isanswered", "nbpra_isapplicable" })
                        if (a.Contains(k)) copy[k] = a[k];
                    copy["nbpra_sectionrevision"] = new EntityReference("nbpra_sectionrevision", revId);
                    copy["ownerid"] = owner;
                    svc.Create(copy);
                }
                Recompute(svc, inst.Id, defId, revId);
            }
        }
    }
}
