import type {
  ActionResult,
  AdminAction,
  BusinessEvent,
  Intake,
  MeetingInfo,
  OpResult,
  Person,
  ReviewDetail,
  ReviewTask,
  SectionDetail,
  SignatoryTask,
  Submission,
  SubmissionDetail,
  UserContext,
} from "./types";

/**
 * Everything the screens read or do goes through this interface. Reads come
 * from tables; every write is a server-side operation that enforces the rules.
 */
export interface DataSource {
  readonly isSample: boolean;
  context(): Promise<UserContext>;

  listSubmissions(): Promise<Submission[]>;
  getSubmission(id: string): Promise<SubmissionDetail | undefined>;
  /** Newest first. Omit the id for every submission the user may see. */
  listEvents(submissionId?: string): Promise<BusinessEvent[]>;

  // Calendar and onboarding
  listMeetings(): Promise<MeetingInfo[]>;
  listPeople(): Promise<Person[]>;
  getIntake(submissionId: string): Promise<Intake>;
  saveOnboarding(submissionId: string | undefined, intake: Intake): Promise<OpResult<string>>;
  submitOnboarding(submissionId: string): Promise<OpResult>;

  // Checklist
  getSection(sectionId: string): Promise<SectionDetail | undefined>;
  saveSection(sectionId: string, answers: { q: string; v: string }[]): Promise<OpResult<string>>;
  submitSection(sectionId: string): Promise<OpResult>;

  // Functional review and signatories
  listReviewTasks(): Promise<ReviewTask[]>;
  getReview(requestId: string): Promise<ReviewDetail | undefined>;
  decideReview(requestId: string, outcome: "approve" | "changes", comment: string): Promise<OpResult>;
  requestSignatories(submissionId: string): Promise<OpResult>;
  listSignatoryTasks(): Promise<SignatoryTask[]>;
  decideSignatory(assignmentId: string, outcome: "approve" | "return", comment: string): Promise<OpResult>;
  finalSubmit(submissionId: string): Promise<OpResult>;

  /** Kate's onboarding and final-admission decisions. */
  decide(submissionId: string, action: AdminAction, comment: string): Promise<ActionResult>;
}
