// Transport for the published code app: the services the Power Apps CLI
// generates in src/generated.
import * as gen from "../generated";
import type { OperationReply, QueryOptions, Row, Transport } from "./transport";

interface Result<T> {
  success: boolean;
  data: T;
  error?: { message?: string };
  skipToken?: string;
}
type GetAll = (options?: Row) => Promise<Result<Row[]>>;

const SERVICES: Record<string, { getAll: unknown }> = {
  nbpra_submissions: gen.Nbpra_submissionsService,
  nbpra_sectioninstances: gen.Nbpra_sectioninstancesService,
  nbpra_sectionrevisions: gen.Nbpra_sectionrevisionsService,
  nbpra_sectiondefs: gen.Nbpra_sectiondefsService,
  nbpra_questiondefs: gen.Nbpra_questiondefsService,
  nbpra_questionoptions: gen.Nbpra_questionoptionsService,
  nbpra_answers: gen.Nbpra_answersService,
  nbpra_signatories: gen.Nbpra_signatoriesService,
  nbpra_businessevents: gen.Nbpra_businesseventsService,
  nbpra_committees: gen.Nbpra_committeesService,
  nbpra_meetings: gen.Nbpra_meetingsService,
  nbpra_slots: gen.Nbpra_slotsService,
  nbpra_slotrequests: gen.Nbpra_slotrequestsService,
  nbpra_approvalrequests: gen.Nbpra_approvalrequestsService,
  nbpra_approvalassignments: gen.Nbpra_approvalassignmentsService,
  nbpra_approvaldecisions: gen.Nbpra_approvaldecisionsService,
  systemusers: gen.SystemusersService,
  teams: gen.TeamsService,
};

function reply(r: Result<Row>): OperationReply {
  if (!r.success) return { Outcome: "error", Message: r.error?.message ?? "The server refused the request." };
  return { Outcome: String(r.data?.Outcome ?? "error"), Message: String(r.data?.Message ?? ""), Data: r.data?.Data as string | undefined };
}

export const sdkTransport: Transport = {
  async query(entitySet, o: QueryOptions = {}) {
    const service = SERVICES[entitySet];
    if (!service) throw new Error(`${entitySet} is not connected to this app.`);
    const getAll = service.getAll as GetAll;
    const out: Row[] = [];
    let skipToken: string | undefined;
    do {
      const r = await getAll({ ...o, ...(skipToken ? { skipToken } : {}) });
      if (!r.success) throw new Error(r.error?.message ?? `Could not load ${entitySet}.`);
      out.push(...(r.data ?? []));
      skipToken = r.skipToken;
    } while (skipToken);
    return out;
  },
  async workflow(operation, targetId, outcome, comment, payload) {
    try {
      return reply((await gen.Nbpra_WorkflowService.nbpra_Workflow(operation, targetId || undefined, outcome || undefined, comment || undefined, payload || undefined)) as Result<Row>);
    } catch (e) {
      return { Outcome: "error", Message: e instanceof Error ? e.message : "The request could not be sent." };
    }
  },
  async adminDecision(submissionId, action, comment) {
    try {
      return reply((await gen.Nbpra_AdminDecisionService.nbpra_AdminDecision(submissionId, action, comment, "App")) as Result<Row>);
    } catch (e) {
      return { Outcome: "error", Message: e instanceof Error ? e.message : "The request could not be sent." };
    }
  },
};
