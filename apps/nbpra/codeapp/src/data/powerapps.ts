// Live data for the published code app, through the services the Power Apps
// CLI generates in src/generated. Lookups are resolved with id maps instead of
// $expand so the mapping does not depend on how the host shapes nested rows.
import { getContext } from "@microsoft/power-apps/app";
import {
  Nbpra_AdminDecisionService,
  Nbpra_businesseventsService,
  Nbpra_meetingsService,
  Nbpra_sectiondefsService,
  Nbpra_sectioninstancesService,
  Nbpra_signatoriesService,
  Nbpra_slotrequestsService,
  Nbpra_slotsService,
  Nbpra_submissionsService,
  SystemusersService,
} from "../generated";
import { DONE_SECTION, NEXT, SIGNED_OFF } from "./derive";
import type { DataSource } from "./source";
import type { ActionResult, BusinessEvent, Channel, DecisionState, SectionStatus, SectionSummary, Signatory, Submission, SubmissionDetail, SubmissionStatus } from "./types";

type Row = Record<string, any>;
interface Result<T> {
  success: boolean;
  data: T;
  error?: { message?: string };
  skipToken?: string;
}
type GetAll = (options?: Row) => Promise<Result<Row[]>>;

// Choice labels in schema order; a stored value is 774100000 plus the index.
const BASE = 774100000;
const LABELS = {
  submission: ["Onboarding Draft", "Awaiting Onboarding Review", "Onboarding Denied", "Checklist in Progress", "Awaiting Signatory Approval", "Ready for Final Submission", "Awaiting Final Admin Review", "Final Changes Requested", "Final Rejected", "Authorized for Committee", "Withdrawn"],
  section: ["Not Started", "Draft", "Ready to Submit", "Under Review", "Changes Requested", "Approved", "Not Applicable", "Superseded"],
  meeting: ["Draft", "Open", "Closed", "Canceled"],
  channel: ["App", "Teams", "Email", "Flow", "System"],
  eventType: ["Submission", "Slot", "Checklist", "Section", "Evidence", "Review request", "Signatory", "Invalidation", "Final submission", "Admission", "Withdrawal", "Notification", "Export"],
};
/** A choice column may arrive as its label (…name) or as the stored number. */
function choice(row: Row, field: string, labels: string[]): string {
  const named = row[field + "name"];
  if (typeof named === "string" && named) return named;
  const n = Number(row[field]);
  return Number.isFinite(n) ? (labels[n - BASE] ?? "") : String(row[field] ?? "");
}

async function all(getAll: GetAll, options: Row = {}): Promise<Row[]> {
  const out: Row[] = [];
  let skipToken: string | undefined;
  do {
    const r = await getAll({ ...options, ...(skipToken ? { skipToken } : {}) });
    if (!r.success) throw new Error(r.error?.message ?? "Could not load data.");
    out.push(...(r.data ?? []));
    skipToken = r.skipToken;
  } while (skipToken);
  return out;
}
const byId = (rows: Row[], key: string) => new Map(rows.map((r) => [r[key] as string, r]));

async function reference() {
  const [users, slots, meetings, requests] = await Promise.all([
    all(SystemusersService.getAll as GetAll, { select: ["systemuserid", "fullname"], filter: "isdisabled eq false" }),
    all(Nbpra_slotsService.getAll as GetAll, { select: ["nbpra_slotid", "nbpra_startat", "_nbpra_meeting_value"] }),
    all(Nbpra_meetingsService.getAll as GetAll, { select: ["nbpra_meetingid", "nbpra_status"] }),
    all(Nbpra_slotrequestsService.getAll as GetAll, { select: ["nbpra_slotrequestid", "_nbpra_requestedslot_value"] }),
  ]);
  return { users: byId(users, "systemuserid"), slots: byId(slots, "nbpra_slotid"), meetings: byId(meetings, "nbpra_meetingid"), requests: byId(requests, "nbpra_slotrequestid") };
}
type Ref = Awaited<ReturnType<typeof reference>>;

const SUB_SELECT = ["nbpra_submissionid", "nbpra_reference", "nbpra_name", "nbpra_businessarea", "nbpra_status", "createdon", "_nbpra_businessowner_value", "_nbpra_sponsor_value", "_nbpra_assignedslot_value", "_nbpra_currentslotrequest_value"];
const SECTION_SELECT = ["nbpra_sectioninstanceid", "_nbpra_submission_value", "_nbpra_sectiondef_value", "nbpra_status", "nbpra_name", "nbpra_isapplicable"];

function toSubmission(r: Row, sections: Row[], ref: Ref): Submission {
  const status = choice(r, "nbpra_status", LABELS.submission) as SubmissionStatus;
  const mine = sections.filter((s) => s._nbpra_submission_value === r.nbpra_submissionid && s.nbpra_isapplicable !== false);
  const label = (s: Row) => choice(s, "nbpra_status", LABELS.section) as SectionStatus;
  const assigned = ref.slots.get(r._nbpra_assignedslot_value);
  const requested = ref.slots.get(ref.requests.get(r._nbpra_currentslotrequest_value)?._nbpra_requestedslot_value);
  const meeting = assigned ? ref.meetings.get(assigned._nbpra_meeting_value) : undefined;
  const canceled = !!meeting && choice(meeting, "nbpra_status", LABELS.meeting) === "Canceled";
  const start: string | undefined = (assigned ?? requested)?.nbpra_startat;
  let blocker: string | undefined;
  if (canceled) blocker = "Assigned meeting was canceled; slot needs reassignment";
  else if (status === "Onboarding Denied" || status === "Final Changes Requested" || status === "Final Rejected") blocker = "See the timeline for Kate's reason";
  const [nextAction, nextActor] = NEXT[status] ?? ["", ""];
  return {
    id: r.nbpra_submissionid,
    reference: r.nbpra_reference ?? "",
    title: r.nbpra_name ?? "(untitled)",
    businessArea: r.nbpra_businessarea ?? "",
    owner: ref.users.get(r._nbpra_businessowner_value)?.fullname ?? "",
    sponsor: ref.users.get(r._nbpra_sponsor_value)?.fullname ?? "",
    status,
    completenessPct: mine.length ? Math.round((mine.filter((s) => DONE_SECTION.includes(label(s))).length / mine.length) * 100) : 0,
    functionalApproved: mine.filter((s) => label(s) === "Approved").length,
    functionalRequired: mine.length,
    signatoriesApproved: SIGNED_OFF.includes(status) ? 5 : 0,
    nextAction,
    nextActor,
    blocker,
    meetingDate: canceled ? undefined : start?.slice(0, 10),
    slot: canceled || !start ? undefined : new Date(start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    slotConfirmed: !!assigned && !canceled,
    ageDays: r.createdon ? Math.max(0, Math.floor((Date.now() - Date.parse(r.createdon)) / 86400000)) : 0,
  };
}

export const powerAppsSource: DataSource & { whoAmI(): Promise<string> } = {
  isSample: false,

  async whoAmI() {
    const ctx = await getContext();
    return ctx.user?.fullName ?? ctx.user?.userPrincipalName ?? "";
  },

  async listSubmissions() {
    const [subs, sections, ref] = await Promise.all([
      all(Nbpra_submissionsService.getAll as GetAll, { select: SUB_SELECT, filter: "statecode eq 0" }),
      all(Nbpra_sectioninstancesService.getAll as GetAll, { select: SECTION_SELECT }),
      reference(),
    ]);
    return subs.map((s) => toSubmission(s, sections, ref));
  },

  async getSubmission(id) {
    const [subs, sections, people, defs, ref] = await Promise.all([
      all(Nbpra_submissionsService.getAll as GetAll, { select: SUB_SELECT, filter: `nbpra_submissionid eq ${id}` }),
      all(Nbpra_sectioninstancesService.getAll as GetAll, { select: SECTION_SELECT, filter: `_nbpra_submission_value eq ${id}` }),
      all(Nbpra_signatoriesService.getAll as GetAll, { select: ["nbpra_slotnumber", "_nbpra_person_value"], filter: `_nbpra_submission_value eq ${id} and nbpra_iscurrent eq true`, orderBy: ["nbpra_slotnumber asc"] }),
      all(Nbpra_sectiondefsService.getAll as GetAll, { select: ["nbpra_sectiondefid", "nbpra_code", "nbpra_displayorder"] }),
      reference(),
    ]);
    if (!subs.length) return undefined;
    const sub = toSubmission(subs[0], sections, ref);
    const defById = byId(defs, "nbpra_sectiondefid");
    const order = (s: Row) => defById.get(s._nbpra_sectiondef_value)?.nbpra_displayorder ?? 0;
    const sectionRows: SectionSummary[] = sections
      .sort((a, b) => order(a) - order(b))
      .map((s) => {
        const status: SectionStatus = s.nbpra_isapplicable === false ? "Not Applicable" : (choice(s, "nbpra_status", LABELS.section) as SectionStatus);
        return { code: defById.get(s._nbpra_sectiondef_value)?.nbpra_code ?? s.nbpra_name, title: s.nbpra_name, status, revision: status === "Not Started" ? 0 : 1, answered: 0, required: 0, groups: [] };
      });
    const sigState: DecisionState = SIGNED_OFF.includes(sub.status) ? "Approved" : sub.status === "Awaiting Signatory Approval" ? "Pending" : "Not requested";
    const signatories: Signatory[] = people.map((p) => ({ slot: p.nbpra_slotnumber, name: ref.users.get(p._nbpra_person_value)?.fullname ?? "(unassigned)", state: sigState }));
    const detail: SubmissionDetail = { ...sub, sections: sectionRows, signatories, blockers: sub.blocker ? [sub.blocker] : [] };
    return detail;
  },

  async listEvents(submissionId) {
    const [rows, users, subs] = await Promise.all([
      all(Nbpra_businesseventsService.getAll as GetAll, {
        select: ["nbpra_businesseventid", "nbpra_occurredat", "nbpra_eventtype", "nbpra_action", "nbpra_oldstatus", "nbpra_newstatus", "nbpra_summary", "nbpra_channel", "nbpra_reason", "_nbpra_submission_value", "_nbpra_actor_value"],
        orderBy: ["nbpra_occurredat desc"],
        ...(submissionId ? { filter: `_nbpra_submission_value eq ${submissionId}` } : {}),
      }),
      all(SystemusersService.getAll as GetAll, { select: ["systemuserid", "fullname"] }),
      all(Nbpra_submissionsService.getAll as GetAll, { select: ["nbpra_submissionid", "nbpra_reference"] }),
    ]);
    const userById = byId(users, "systemuserid");
    const subById = byId(subs, "nbpra_submissionid");
    return rows.map(
      (e): BusinessEvent => ({
        id: e.nbpra_businesseventid,
        submissionId: e._nbpra_submission_value,
        reference: subById.get(e._nbpra_submission_value)?.nbpra_reference ?? "",
        occurredAt: e.nbpra_occurredat,
        actor: userById.get(e._nbpra_actor_value)?.fullname ?? "System",
        eventType: choice(e, "nbpra_eventtype", LABELS.eventType),
        action: e.nbpra_action ?? "",
        oldStatus: e.nbpra_oldstatus ?? undefined,
        newStatus: e.nbpra_newstatus ?? undefined,
        revision: e.nbpra_summary ?? undefined,
        channel: (choice(e, "nbpra_channel", LABELS.channel) || "App") as Channel,
        reason: e.nbpra_reason ?? undefined,
      }),
    );
  },

  async decide(submissionId, action, comment): Promise<ActionResult> {
    try {
      const r = (await Nbpra_AdminDecisionService.nbpra_AdminDecision(submissionId, action, comment, "App")) as Result<Row>;
      if (!r.success) return { ok: false, error: r.error?.message ?? "The server refused the decision." };
      return r.data?.Outcome === "accepted" ? { ok: true } : { ok: false, error: r.data?.Message ?? "The decision was not recorded." };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "The decision could not be sent." };
    }
  },
};
