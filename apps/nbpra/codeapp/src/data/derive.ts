// Figures the screens show that are derived from stored records, shared by
// both live data sources.
import type { SectionStatus, SubmissionStatus } from "./types";

export const NEXT: Record<SubmissionStatus, [action: string, actor: string]> = {
  "Onboarding Draft": ["Complete and submit onboarding", "Submitter"],
  "Awaiting Onboarding Review": ["Kate to review onboarding request", "Kate"],
  "Onboarding Denied": ["Revise and resubmit onboarding", "Submitter"],
  "Checklist in Progress": ["Complete checklist sections and obtain functional approvals", "Submitter"],
  "Awaiting Signatory Approval": ["Signatories to approve the package", "Signatories"],
  "Ready for Final Submission": ["Make final submission", "Submitter"],
  "Awaiting Final Admin Review": ["Kate to review final package", "Kate"],
  "Final Changes Requested": ["Revise and resubmit", "Submitter"],
  "Final Rejected": ["Closed pending reopen", "Submitter"],
  "Authorized for Committee": ["Attend committee", "None"],
  Withdrawn: ["Closed", "None"],
};

export const SIGNED_OFF: SubmissionStatus[] = ["Ready for Final Submission", "Awaiting Final Admin Review", "Authorized for Committee"];
export const DONE_SECTION: SectionStatus[] = ["Ready to Submit", "Under Review", "Approved"];
