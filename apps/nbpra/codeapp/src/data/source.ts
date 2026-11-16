import type {
  ActionResult,
  AdminAction,
  BusinessEvent,
  ExportInfo,
  FileContent,
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
  /** Company directory search by name or email. */
  searchPeople(term: string): Promise<Person[]>;
  getIntake(submissionId: string): Promise<Intake>;
  saveOnboarding(submissionId: string | undefined, intake: Intake): Promise<OpResult<string>>;
  submitOnboarding(submissionId: string): Promise<OpResult>;

  // Checklist
  getSection(sectionId: string): Promise<SectionDetail | undefined>;
  saveSection(sectionId: string, answers: { q: string; v: string }[]): Promise<OpResult<string>>;
  submitSection(sectionId: string): Promise<OpResult>;

  // Evidence, memo and reuse
  uploadEvidence(sectionId: string, questionId: string, file: FileContent): Promise<OpResult<string>>;
  downloadFile(kind: "evidence" | "export", id: string): Promise<OpResult<FileContent>>;
  listExports(submissionId: string): Promise<ExportInfo[]>;
  saveMemo(submissionId: string, fileName: string, base64: string): Promise<OpResult<string>>;
  /** New draft holding an earlier submission's content; never its approvals, files or signatories. */
  copySubmission(submissionId: string): Promise<OpResult<string>>;

  // Functional review and signatories
  listReviewTasks(): Promise<ReviewTask[]>;
  getReview(requestId: string): Promise<ReviewDetail | undefined>;
  decideReview(requestId: string, outcome: "approve" | "changes", comment: string): Promise<OpResult>;
  /** Names the person for one signatory seat (2 to 6; seat 1 is the sponsor). Returns the signatory id. */
  setSignatory(submissionId: string, seat: number, person: Person, role: string): Promise<OpResult<string>>;
  /** Sends that signatory their approval request. Each can be sent as soon as their area is done. */
  sendSignatory(signatoryId: string): Promise<OpResult>;
  /** Requests waiting on the signed-in person. Most signatories answer from the email instead. */
  listSignatoryTasks(): Promise<SignatoryTask[]>;
  /** The signatory's own answer, or an administrator recording one received another way (comment required). */
  decideSignatory(signatoryId: string, outcome: "approve" | "return", comment: string): Promise<OpResult>;
  finalSubmit(submissionId: string): Promise<OpResult>;

  /** Administrator's update for the submitter. Replaces the one shown; all are kept in the timeline. */
  postNote(submissionId: string, text: string): Promise<OpResult>;

  /** Kate's onboarding and final-admission decisions. */
  decide(submissionId: string, action: AdminAction, comment: string): Promise<ActionResult>;
}
