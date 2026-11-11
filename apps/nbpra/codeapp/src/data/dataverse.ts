import type { DataSource } from "./source";
import type {
  ActionResult,
  AdminAction,
  BusinessEvent,
  Channel,
  DecisionState,
  SectionStatus,
  SectionSummary,
  Signatory,
  Submission,
  SubmissionDetail,
  SubmissionStatus,
} from "./types";

/**
 * Reads and writes NBPRA data through the Dataverse Web API.
 *
 * Hosted as a web resource the app shares the org's origin, so the default
 * relative base and the signed-in session are enough. Tests pass an absolute
 * base URL and an Authorization header.
 */
export interface DataverseOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  fetchFn?: typeof fetch;
}

const FV = "@OData.Community.Display.V1.FormattedValue";
type Row = Record<string, any>;

const NEXT: Record<SubmissionStatus, [action: string, actor: string]> = {
  "Onboarding Draft": ["Complete and submit onboarding", "Submitter"],
  "Awaiting Onboarding Review": ["Kate to review onboarding request", "Kate"],
  "Onboarding Denied": ["Revise and resubmit onboarding", "Submitter"],
  "Checklist in Progress": ["Complete checklist sections and obtain functional approvals", "Submitter"],
  "Awaiting Signatory Approval": ["Signatories to approve the package", "Signatories"],
  "Ready for Final Submission": ["Make final submission", "Submitter"],
  "Awaiting Final Admin Review": ["Kate to review final package", "Kate"],
  "Final Changes Requested": ["Revise and resubmit", "Submitter"],
  "Final Rejected": ["Closed pending reopen", "Submitter"],
  "Authorized for Committee": ["Attend committee", "None"],
  Withdrawn: ["Closed", "None"],
};

const SIGNED_OFF: SubmissionStatus[] = ["Ready for Final Submission", "Awaiting Final Admin Review", "Authorized for Committee"];
const DONE_SECTION: SectionStatus[] = ["Ready to Submit", "Under Review", "Approved"];

export function createDataverseSource(opts: DataverseOptions = {}): DataSource & { whoAmI(): Promise<string> } {
  const base = (opts.baseUrl ?? "") + "/api/data/v9.2/";
  const doFetch = opts.fetchFn ?? fetch.bind(globalThis);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "OData-Version": "4.0",
    "OData-MaxVersion": "4.0",
    Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    ...opts.headers,
  };

  async function get(path: string): Promise<Row[]> {
    const out: Row[] = [];
    let url: string | undefined = base + path;
    while (url) {
      const r: Response = await doFetch(url, { headers });
      if (!r.ok) throw new Error(`Dataverse ${r.status}: ${(await r.text()).slice(0, 300)}`);
      const j: Row = await r.json();
      if (!Array.isArray(j.value)) return [j];
      out.push(...j.value);
      url = j["@odata.nextLink"]; // follow paging so counts never stop at one page
    }
    return out;
  }

  const SUB_QUERY =
    "$select=nbpra_reference,nbpra_name,nbpra_businessarea,nbpra_status,createdon,nbpra_packagerevision" +
    "&$expand=nbpra_businessowner($select=fullname),nbpra_sponsor($select=fullname)," +
    "nbpra_assignedslot($select=nbpra_startat;$expand=nbpra_meeting($select=nbpra_status))," +
    "nbpra_currentslotrequest($select=nbpra_revisionnumber;$expand=nbpra_requestedslot($select=nbpra_startat))";

  function toSubmission(r: Row, sections: Row[]): Submission {
    const status = r["nbpra_status" + FV] as SubmissionStatus;
    const mine = sections.filter((s) => s._nbpra_submission_value === r.nbpra_submissionid && s.nbpra_isapplicable !== false);
    const label = (s: Row) => s["nbpra_status" + FV] as SectionStatus;
    const approved = mine.filter((s) => label(s) === "Approved").length;
    const complete = mine.filter((s) => DONE_SECTION.includes(label(s))).length;
    const assigned = r.nbpra_assignedslot;
    const requested = r.nbpra_currentslotrequest?.nbpra_requestedslot;
    const start: string | undefined = assigned?.nbpra_startat ?? requested?.nbpra_startat;
    const canceled = assigned?.nbpra_meeting?.["nbpra_status" + FV] === "Canceled";
    let blocker: string | undefined;
    if (canceled) blocker = "Assigned meeting was canceled; slot needs reassignment";
    else if (status === "Onboarding Denied" || status === "Final Changes Requested" || status === "Final Rejected") blocker = "See the timeline for Kate's reason";
    const [nextAction, nextActor] = NEXT[status] ?? ["", ""];
    return {
      id: r.nbpra_submissionid,
      reference: r.nbpra_reference ?? "",
      title: r.nbpra_name ?? "(untitled)",
      businessArea: r.nbpra_businessarea ?? "",
      owner: r.nbpra_businessowner?.fullname ?? "",
      sponsor: r.nbpra_sponsor?.fullname ?? "",
      status,
      completenessPct: mine.length ? Math.round((complete / mine.length) * 100) : 0,
      // Until section-level review requests exist, one approval per applicable section.
      functionalApproved: approved,
      functionalRequired: mine.length,
      // Until signatory decisions are recorded, inferred from the lifecycle stage.
      signatoriesApproved: SIGNED_OFF.includes(status) ? 5 : 0,
      nextAction,
      nextActor,
      blocker,
      meetingDate: canceled ? undefined : start?.slice(0, 10),
      slot: canceled || !start ? undefined : new Date(start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      slotConfirmed: !!assigned && !canceled,
      ageDays: Math.max(0, Math.floor((Date.now() - Date.parse(r.createdon)) / 86400000)),
    };
  }

  const SECTION_QUERY = "nbpra_sectioninstances?$select=_nbpra_submission_value,nbpra_status,nbpra_name,nbpra_isapplicable&$expand=nbpra_sectiondef($select=nbpra_code,nbpra_displayorder)";

  return {
    isSample: false,

    async whoAmI() {
      const [me] = await get("WhoAmI");
      const [user] = await get(`systemusers(${me.UserId})?$select=fullname`);
      return user.fullname;
    },

    async listSubmissions() {
      const [subs, sections] = await Promise.all([get(`nbpra_submissions?${SUB_QUERY}&$filter=statecode eq 0`), get(SECTION_QUERY)]);
      return subs.map((s) => toSubmission(s, sections));
    },

    async getSubmission(id) {
      const rows = await get(`nbpra_submissions(${id})?${SUB_QUERY}`).catch(() => []);
      if (!rows.length) return undefined;
      const [sections, people] = await Promise.all([
        get(`${SECTION_QUERY}&$filter=_nbpra_submission_value eq ${id}`),
        get(`nbpra_signatories?$select=nbpra_slotnumber&$filter=_nbpra_submission_value eq ${id} and nbpra_iscurrent eq true&$orderby=nbpra_slotnumber&$expand=nbpra_person($select=fullname)`),
      ]);
      const sub = toSubmission(rows[0], sections);
      const sectionRows: SectionSummary[] = sections
        .sort((a, b) => (a.nbpra_sectiondef?.nbpra_displayorder ?? 0) - (b.nbpra_sectiondef?.nbpra_displayorder ?? 0))
        .map((s) => {
          const status: SectionStatus = s.nbpra_isapplicable === false ? "Not Applicable" : (s["nbpra_status" + FV] as SectionStatus);
          return { code: s.nbpra_sectiondef?.nbpra_code ?? s.nbpra_name, title: s.nbpra_name, status, revision: status === "Not Started" ? 0 : 1, answered: 0, required: 0, groups: [] };
        });
      const sigState: DecisionState = SIGNED_OFF.includes(sub.status) ? "Approved" : sub.status === "Awaiting Signatory Approval" ? "Pending" : "Not requested";
      const signatories: Signatory[] = people.map((p) => ({ slot: p.nbpra_slotnumber, name: p.nbpra_person?.fullname ?? "(unassigned)", state: sigState }));
      const detail: SubmissionDetail = { ...sub, sections: sectionRows, signatories, blockers: sub.blocker ? [sub.blocker] : [] };
      return detail;
    },

    async listEvents(submissionId) {
      const filter = submissionId ? `&$filter=_nbpra_submission_value eq ${submissionId}` : "";
      const rows = await get(
        "nbpra_businessevents?$select=nbpra_occurredat,nbpra_eventtype,nbpra_action,nbpra_oldstatus,nbpra_newstatus,nbpra_summary,nbpra_channel,nbpra_reason,nbpra_actorkind,_nbpra_submission_value" +
          `&$expand=nbpra_actor($select=fullname),nbpra_submission($select=nbpra_reference)&$orderby=nbpra_occurredat desc${filter}`,
      );
      return rows.map(
        (e): BusinessEvent => ({
          id: e.nbpra_businesseventid,
          submissionId: e._nbpra_submission_value,
          reference: e.nbpra_submission?.nbpra_reference ?? "",
          occurredAt: e.nbpra_occurredat,
          actor: e.nbpra_actor?.fullname ?? "System",
          eventType: e["nbpra_eventtype" + FV] ?? "",
          action: e.nbpra_action ?? "",
          oldStatus: e.nbpra_oldstatus ?? undefined,
          newStatus: e.nbpra_newstatus ?? undefined,
          revision: e.nbpra_summary ?? undefined,
          channel: (e["nbpra_channel" + FV] ?? "App") as Channel,
          reason: e.nbpra_reason ?? undefined,
        }),
      );
    },

    async decide(submissionId, action: AdminAction, comment): Promise<ActionResult> {
      const r = await doFetch(base + "nbpra_AdminDecision", {
        method: "POST",
        headers,
        body: JSON.stringify({ SubmissionId: submissionId, Action: action, Comment: comment, Channel: "App" }),
      });
      const j: Row = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: j.error?.message ?? `The server refused the decision (${r.status}).` };
      return j.Outcome === "accepted" ? { ok: true } : { ok: false, error: j.Message ?? "The decision was not recorded." };
    },
  };
}
