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
  nbpra_evidences: gen.Nbpra_evidencesService,
  nbpra_exportpackages: gen.Nbpra_exportpackagesService,
  systemusers: gen.SystemusersService,
  teams: gen.TeamsService,
};

function reply(r: Result<Row>): OperationReply {
  if (!r.success) return { Outcome: "error", Message: r.error?.message ?? "The server refused the request." };
  return { Outcome: String(r.data?.Outcome ?? "error"), Message: String(r.data?.Message ?? ""), Data: r.data?.Data as string | undefined };
}

interface DirectoryUser {
  Id?: string;
  DisplayName?: string;
  Mail?: string;
  UserPrincipalName?: string;
  JobTitle?: string;
}
// Present once the Office 365 Users connector has been added to the app
// (pa app add-data-source); until then people are looked up among app users.
const office365Users = (gen as unknown as { Office365UsersService?: { SearchUserV2(searchTerm?: string, top?: number): Promise<Result<{ value?: DirectoryUser[] }>> } }).Office365UsersService;

export const sdkTransport: Transport = {
  async searchPeople(term) {
    if (office365Users) {
      const r = await office365Users.SearchUserV2(term, 10);
      if (!r.success) throw new Error(r.error?.message ?? "The directory search failed.");
      return (r.data?.value ?? []).map((u) => ({ id: u.Id ?? "", name: u.DisplayName ?? u.Mail ?? "", email: u.Mail ?? u.UserPrincipalName ?? "", jobTitle: u.JobTitle || undefined })).filter((u) => u.email);
    }
    const q = term.replace(/'/g, "''");
    const users = await this.query("systemusers", { select: ["systemuserid", "azureactivedirectoryobjectid", "fullname", "internalemailaddress", "title"], filter: `isdisabled eq false and accessmode eq 0 and (contains(fullname,'${q}') or startswith(internalemailaddress,'${q}'))` });
    return users.slice(0, 10).map((u) => ({ id: u.azureactivedirectoryobjectid ?? u.systemuserid, name: u.fullname, email: u.internalemailaddress ?? "", jobTitle: u.title ?? undefined })).filter((u) => u.email);
  },
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
