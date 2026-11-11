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
  /** Section instance id; empty for sample rows. */
  id: string;
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
  ownerId: string;
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

export type Channel = "App" | "Teams" | "Email" | "System";

/** One row of the append-only business timeline (requirements section 9.2). */
export interface BusinessEvent {
  id: string;
  submissionId: string;
  reference: string;
  /** UTC, ISO 8601. */
  occurredAt: string;
  actor: string;
  eventType: string;
  action: string;
  oldStatus?: string;
  newStatus?: string;
  revision?: string;
  channel: Channel;
  reason?: string;
}

export type AdminAction = "approveOnboarding" | "denyOnboarding" | "authorize" | "returnFinal" | "rejectFinal";

export type ActionResult = { ok: true } | { ok: false; error: string };

// ---- submission journey -------------------------------------------------------

export interface UserContext {
  userId: string;
  fullName: string;
  isAdmin: boolean;
}

export interface Person {
  id: string;
  name: string;
}

export interface SlotInfo {
  id: string;
  reference: string;
  startAt: string;
  endAt: string;
  capacity: number;
  allocated: number;
  /** Open slots in an open meeting inside its request window, with capacity left. */
  requestable: boolean;
  status: string;
}

export interface MeetingInfo {
  id: string;
  name: string;
  committee: string;
  startAt: string;
  endAt: string;
  status: string;
  requestCloseAt?: string;
  slots: SlotInfo[];
}

export interface Intake {
  title: string;
  businessArea: string;
  proposalType: string;
  summary: string;
  scope: string;
  sponsorId: string;
  slotId: string;
  /** Exactly five entries; an empty string is an unfilled seat. */
  signatories: string[];
}

export type AnswerType = "Text" | "Long text" | "Boolean" | "Choice" | "Number" | "Date";

export interface Question {
  id: string;
  code: string;
  label: string;
  type: AnswerType;
  required: boolean;
  options: { code: string; label: string }[];
  /** Stored answer as text: "true"/"false", a number, an ISO date, an option code or free text. */
  value: string;
}

export interface SectionDetail {
  id: string;
  title: string;
  status: SectionStatus;
  revision: number;
  editable: boolean;
  questions: Question[];
  /** Reviewer's reason when the previous revision was returned. */
  returnedReason?: string;
}

export interface ReviewTask {
  requestId: string;
  submissionId: string;
  reference: string;
  title: string;
  section: string;
  team: string;
  requestedAt: string;
}

export interface ReviewDetail extends ReviewTask {
  answers: { label: string; value: string }[];
}

export interface SignatoryTask {
  assignmentId: string;
  submissionId: string;
  reference: string;
  title: string;
  seat: string;
  packageRevision: number;
}

export type OpResult<T = void> = { ok: true; message: string; data: T } | { ok: false; error: string };
