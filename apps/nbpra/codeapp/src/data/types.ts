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

/** Seats on every submission: the sponsor named at onboarding plus five the submitter chooses. */
export const SIGNATORY_SEATS = 6;

export interface Signatory {
  /** Empty until a person is named for the seat. */
  id: string;
  /** 1 is the business unit sponsor; 2 to 6 are chosen by the submitter. */
  slot: number;
  name: string;
  email: string;
  /** What the person signs for, in the submitter's words. */
  role: string;
  state: DecisionState;
  requestedAt?: string;
  decidedAt?: string;
  comment?: string;
}

export interface SubmissionDetail extends Submission {
  ownerId: string;
  /** Latest update the administrator posted for this submission, such as when to join. */
  adminNote?: AdminNote;
  /** Update on the meeting itself, shown to everyone with a place at it. */
  meetingNote?: string;
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
  email: string;
  /** Directory object id; empty when the user has none. */
  directoryId: string;
  isAdmin: boolean;
}

/** A person from the company directory. They need not be a user of this app. */
export interface Person {
  /** Directory object id. */
  id: string;
  name: string;
  email: string;
  jobTitle?: string;
}

/** A committee meeting takes a fixed number of submissions; there are no individual time slots. */
export interface MeetingInfo {
  id: string;
  name: string;
  committee: string;
  startAt: string;
  endAt: string;
  status: string;
  requestCloseAt?: string;
  /** The record a request for a place at this meeting points at. */
  slotId: string;
  capacity: number;
  /** Places taken: submissions the administrator has confirmed. Requests awaiting a decision do not count. */
  taken: number;
  remaining: number;
  requestable: boolean;
  /** Why it cannot be requested, when it cannot. */
  closedReason?: string;
  /** The administrator's update for everyone attending. */
  note?: string;
}

export interface AdminNote {
  text: string;
  at: string;
  by: string;
}

export interface Intake {
  title: string;
  businessArea: string;
  proposalType: string;
  summary: string;
  scope: string;
  /** Business unit sponsor: named here, and the sixth signatory at the end. */
  sponsor: Person | null;
  slotId: string;
  /** Reference of the earlier submission this draft was started from, if any. Read-only. */
  copiedFrom?: string;
}

export type AnswerType = "Text" | "Long text" | "Boolean" | "Choice" | "Number" | "Date" | "File";

export interface StoredFile {
  id: string;
  name: string;
  sizeBytes: number;
  version: number;
  uploadedAt: string;
}

export interface FileContent {
  fileName: string;
  contentType: string;
  base64: string;
}

export interface ExportInfo {
  id: string;
  fileName: string;
  type: string;
  generatedAt: string;
  requestedBy: string;
}

export interface Question {
  id: string;
  code: string;
  label: string;
  type: AnswerType;
  required: boolean;
  options: { code: string; label: string }[];
  /** Stored answer as text: "true"/"false", a number, an ISO date, an option code or free text. */
  value: string;
  /** File questions only: the current upload, and the extensions the question accepts. */
  file?: StoredFile;
  accept?: string[];
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
  answers: { label: string; value: string; fileId?: string }[];
}

export interface SignatoryTask {
  signatoryId: string;
  submissionId: string;
  reference: string;
  title: string;
  /** What the signed-in person is asked to sign for. */
  role: string;
  requestedAt?: string;
}

export type OpResult<T = void> = { ok: true; message: string; data: T } | { ok: false; error: string };
