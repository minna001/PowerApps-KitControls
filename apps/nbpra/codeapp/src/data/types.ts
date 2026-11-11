// Mirrors the lifecycle in MVP Requirements v1.0, sections 3.2 and 3.3.
export type SubmissionStatus =
  | "Onboarding Draft"
  | "Awaiting Onboarding Review"
  | "Onboarding Denied"
  | "Checklist in Progress"
  | "Awaiting Signatory Approval"
  | "Ready for Final Submission"
  | "Awaiting Final Admin Review"
  | "Final Changes Requested"
  | "Final Rejected"
  | "Authorized for Committee"
  | "Withdrawn";

export type SectionStatus =
  | "Not Started"
  | "Draft"
  | "Ready to Submit"
  | "Under Review"
  | "Changes Requested"
  | "Approved"
  | "Not Applicable";

export type DecisionState = "Not requested" | "Pending" | "Approved" | "Returned";

export interface Submission {
  id: string;
  reference: string;
  title: string;
  businessArea: string;
  owner: string;
  sponsor: string;
  status: SubmissionStatus;
  /** Share of required answers and evidence present. Not an approval measure. */
  completenessPct: number;
  functionalApproved: number;
  functionalRequired: number;
  signatoriesApproved: number;
  nextAction: string;
  nextActor: string;
  blocker?: string;
  meetingDate?: string;
  slot?: string;
  slotConfirmed: boolean;
  ageDays: number;
}

export interface SectionSummary {
  code: string;
  title: string;
  status: SectionStatus;
  revision: number;
  answered: number;
  required: number;
  groups: { name: string; state: DecisionState }[];
}

export interface Signatory {
  slot: number;
  name: string;
  state: DecisionState;
}

export interface SubmissionDetail extends Submission {
  sections: SectionSummary[];
  signatories: Signatory[];
  blockers: string[];
}

/** The six steps a submission passes through on the way to committee. */
export const PHASES = [
  "Onboarding",
  "Checklist",
  "Functional approval",
  "Five signatories",
  "Final review",
  "Authorized",
] as const;

export function phaseIndex(s: SubmissionStatus): number {
  switch (s) {
    case "Onboarding Draft":
    case "Awaiting Onboarding Review":
    case "Onboarding Denied":
      return 0;
    case "Checklist in Progress":
      return 1;
    case "Awaiting Signatory Approval":
      return 3;
    case "Ready for Final Submission":
    case "Awaiting Final Admin Review":
    case "Final Changes Requested":
    case "Final Rejected":
      return 4;
    case "Authorized for Committee":
      return 5;
    case "Withdrawn":
      return -1;
  }
}
