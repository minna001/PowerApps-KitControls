import type { Submission, SubmissionDetail } from "./types";

/**
 * Everything the screens read goes through this interface. The sample
 * implementation lives in ./sample.ts; the Dataverse implementation replaces
 * it once an environment is connected, with no screen changes.
 */
export interface DataSource {
  readonly isSample: boolean;
  listSubmissions(): Promise<Submission[]>;
  getSubmission(id: string): Promise<SubmissionDetail | undefined>;
}
