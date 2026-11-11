// The live data layer (live.ts) talks to Dataverse through this small
// interface, so the same mapping code runs in the published code app (Power
// Apps SDK) and against the Web API directly (web resource build and tests).
export type Row = Record<string, any>;

export interface QueryOptions {
  select?: string[];
  filter?: string;
  orderBy?: string[];
}

export interface OperationReply {
  Outcome: string;
  Message: string;
  Data?: string;
}

export interface Transport {
  /** Every matching row of an entity set such as "nbpra_submissions", following paging. */
  query(entitySet: string, options?: QueryOptions): Promise<Row[]>;
  workflow(operation: string, targetId?: string, outcome?: string, comment?: string, payload?: string): Promise<OperationReply>;
  adminDecision(submissionId: string, action: string, comment: string): Promise<OperationReply>;
}
