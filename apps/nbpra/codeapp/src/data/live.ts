// Live data: maps Dataverse rows to what the screens show. Lookups are joined
// with id maps (no $expand) so the code is identical over both transports.
import { DONE_SECTION, NEXT } from "./derive";
import type { DataSource } from "./source";
import type { OperationReply, Row, Transport } from "./transport";
import type {
  ActionResult,
  AnswerType,
  BusinessEvent,
  Channel,
  DecisionState,
  ExportInfo,
  FileContent,
  Intake,
  MeetingInfo,
  OpResult,
  Person,
  Question,
  ReviewDetail,
  ReviewTask,
  SectionDetail,
  SectionStatus,
  SectionSummary,
  Signatory,
  SignatoryTask,
  Submission,
  SubmissionDetail,
  SubmissionStatus,
  UserContext,
} from "./types";
import { SIGNATORY_SEATS } from "./types";

// Choice labels in schema order; a stored value is BASE plus the index.
const BASE = 774100000;
const L = {
  submission: ["Onboarding Draft", "Awaiting Onboarding Review", "Onboarding Denied", "Checklist in Progress", "Awaiting Signatory Approval", "Ready for Final Submission", "Awaiting Final Admin Review", "Final Changes Requested", "Final Rejected", "Authorized for Committee", "Withdrawn"],
  section: ["Not Started", "Draft", "Ready to Submit", "Under Review", "Changes Requested", "Approved", "Not Applicable", "Superseded"],
  meeting: ["Draft", "Open", "Closed", "Canceled"],
  slot: ["Open", "Blocked", "Closed", "Canceled"],
  channel: ["App", "Teams", "Email", "Flow", "System"],
  exportType: ["Draft", "Submitted", "Committee-authorized"],
  eventType: ["Submission", "Slot", "Checklist", "Section", "Evidence", "Review request", "Signatory", "Invalidation", "Final submission", "Admission", "Withdrawal", "Notification", "Export"],
  answerType: ["Text", "Long text", "Boolean", "Choice", "Multi-choice", "Number", "Currency", "Date", "Person", "File"],
  approval: ["Pending", "Approved", "Changes Requested", "Denied", "Superseded", "Canceled"],
};
const PURPOSE = { onboarding: BASE, functional: BASE + 1, signatory: BASE + 2, final: BASE + 3 };
const PENDING = BASE; // first option of the approval and assignment status lists
const SLOT_REQUEST_DRAFT = BASE;

/** A choice column may arrive as its label (…name) or as the stored number. */
function choice(row: Row | undefined, field: string, labels: string[]): string {
  if (!row) return "";
  const named = row[field + "name"];
  if (typeof named === "string" && named) return named;
  const n = Number(row[field]);
  return Number.isFinite(n) && row[field] !== null && row[field] !== undefined ? (labels[n - BASE] ?? "") : "";
}
const byId = (rows: Row[], key: string) => new Map(rows.map((r) => [r[key] as string, r]));
const anyOf = (field: string, ids: string[]) => ids.map((id) => `${field} eq ${id}`).join(" or ");

function result<T>(r: OperationReply, data: (d: string) => T): OpResult<T> {
  return r.Outcome === "accepted" ? { ok: true, message: r.Message, data: data(r.Data ?? "") } : { ok: false, error: r.Message || "The request was not accepted." };
}
const plain = (r: OperationReply): OpResult => result(r, () => undefined);

export function createLiveSource(t: Transport): DataSource {
  let me: Promise<UserContext> | undefined;
  const context = () =>
    (me ??= t.workflow("context").then((r) => {
      if (r.Outcome !== "accepted" || !r.Data) throw new Error(r.Message || "Could not identify the signed-in user.");
      return JSON.parse(r.Data) as UserContext;
    }));

  async function reference() {
    const [users, slots, meetings, requests] = await Promise.all([
      t.query("systemusers", { select: ["systemuserid", "fullname"] }),
      t.query("nbpra_slots", { select: ["nbpra_slotid", "nbpra_startat", "_nbpra_meeting_value"] }),
      t.query("nbpra_meetings", { select: ["nbpra_meetingid", "nbpra_status", "nbpra_updatenote"] }),
      t.query("nbpra_slotrequests", { select: ["nbpra_slotrequestid", "_nbpra_requestedslot_value"] }),
    ]);
    return { users: byId(users, "systemuserid"), slots: byId(slots, "nbpra_slotid"), meetings: byId(meetings, "nbpra_meetingid"), requests: byId(requests, "nbpra_slotrequestid") };
  }
  type Ref = Awaited<ReturnType<typeof reference>>;

  const SUB_SELECT = ["nbpra_submissionid", "nbpra_reference", "nbpra_name", "nbpra_businessarea", "nbpra_status", "createdon", "nbpra_packagerevision", "nbpra_adminnote", "nbpra_adminnoteat", "_nbpra_adminnoteby_value", "_nbpra_businessowner_value", "_nbpra_sponsor_value", "_nbpra_assignedslot_value", "_nbpra_currentslotrequest_value"];
  const SECTION_SELECT = ["nbpra_sectioninstanceid", "_nbpra_submission_value", "_nbpra_sectiondef_value", "_nbpra_currentrevision_value", "nbpra_status", "nbpra_name", "nbpra_isapplicable"];

  const SEAT_SELECT = ["nbpra_signatoryid", "nbpra_slotnumber", "nbpra_displayname", "nbpra_email", "nbpra_role", "nbpra_status", "nbpra_requestedat", "nbpra_decidedat", "nbpra_decisioncomment", "_nbpra_submission_value"];
  const SEAT_STATE: DecisionState[] = ["Not requested", "Pending", "Approved", "Returned"];
  const seatState = (r: Row): DecisionState => SEAT_STATE[Number(r.nbpra_status) - BASE] ?? "Not requested";

  /** Per submission: how many current signatories have approved, and who the sponsor is. */
  async function signatoryProgress(): Promise<{ approved: Map<string, number>; sponsors: Map<string, string> }> {
    const seats = await t.query("nbpra_signatories", { select: ["_nbpra_submission_value", "nbpra_slotnumber", "nbpra_displayname", "nbpra_status"], filter: "nbpra_iscurrent eq true" });
    const approved = new Map<string, number>();
    const sponsors = new Map<string, string>();
    for (const s of seats) {
      const sub = s._nbpra_submission_value;
      if (seatState(s) === "Approved") approved.set(sub, (approved.get(sub) ?? 0) + 1);
      if (s.nbpra_slotnumber === 1) sponsors.set(sub, s.nbpra_displayname ?? "");
    }
    return { approved, sponsors };
  }

  function toSubmission(r: Row, sections: Row[], ref: Ref, signed: Map<string, number>, sponsors: Map<string, string>): Submission {
    const status = choice(r, "nbpra_status", L.submission) as SubmissionStatus;
    const mine = sections.filter((s) => s._nbpra_submission_value === r.nbpra_submissionid && s.nbpra_isapplicable !== false);
    const label = (s: Row) => choice(s, "nbpra_status", L.section) as SectionStatus;
    const assigned = ref.slots.get(r._nbpra_assignedslot_value);
    const requested = ref.slots.get(ref.requests.get(r._nbpra_currentslotrequest_value)?._nbpra_requestedslot_value);
    const meeting = assigned ? ref.meetings.get(assigned._nbpra_meeting_value) : undefined;
    const canceled = choice(meeting, "nbpra_status", L.meeting) === "Canceled";
    const start: string | undefined = (assigned ?? requested)?.nbpra_startat;
    let blocker: string | undefined;
    if (canceled) blocker = "Assigned meeting was canceled; slot needs reassignment";
    else if (status === "Onboarding Denied" || status === "Final Changes Requested" || status === "Final Rejected") blocker = "See the timeline for the administrator's reason";
    else if (mine.some((s) => label(s) === "Changes Requested")) blocker = "A reviewer returned a checklist section";
    let [nextAction, nextActor] = NEXT[status] ?? ["", ""];
    if (status === "Checklist in Progress" && mine.length) {
      const got = signed.get(r.nbpra_submissionid) ?? 0;
      if (mine.every((s) => label(s) === "Approved")) [nextAction, nextActor] = [`Collect the remaining signatory approvals (${got} of ${SIGNATORY_SEATS})`, "Submitter"];
      else if (mine.every((s) => label(s) === "Approved" || label(s) === "Under Review")) [nextAction, nextActor] = ["Functional groups to review submitted sections", "Functional approvers"];
    }
    return {
      id: r.nbpra_submissionid,
      reference: r.nbpra_reference ?? "",
      title: r.nbpra_name ?? "(untitled)",
      businessArea: r.nbpra_businessarea ?? "",
      owner: ref.users.get(r._nbpra_businessowner_value)?.fullname ?? "",
      sponsor: sponsors.get(r.nbpra_submissionid) ?? "",
      status,
      completenessPct: mine.length ? Math.round((mine.filter((s) => DONE_SECTION.includes(label(s))).length / mine.length) * 100) : 0,
      functionalApproved: mine.filter((s) => label(s) === "Approved").length,
      functionalRequired: mine.length,
      signatoriesApproved: signed.get(r.nbpra_submissionid) ?? 0,
      nextAction,
      nextActor,
      blocker,
      meetingDate: canceled ? undefined : start?.slice(0, 10),
      slot: undefined, // meetings have places, not timed slots; the administrator says when to join
      slotConfirmed: !!assigned && !canceled,
      ageDays: r.createdon ? Math.max(0, Math.floor((Date.now() - Date.parse(r.createdon)) / 86400000)) : 0,
    };
  }

  /** Questions of a section with the answers stored on one revision. */
  async function questionsWithAnswers(sectionDefId: string, revisionId: string | undefined): Promise<Question[]> {
    const defs = await t.query("nbpra_questiondefs", { select: ["nbpra_questiondefid", "nbpra_code", "nbpra_label", "nbpra_answertype", "nbpra_isrequired", "nbpra_displayorder", "nbpra_validationrule"], filter: `_nbpra_sectiondef_value eq ${sectionDefId}`, orderBy: ["nbpra_displayorder asc"] });
    if (!defs.length) return [];
    const [options, answers, files] = await Promise.all([
      t.query("nbpra_questionoptions", { select: ["_nbpra_questiondef_value", "nbpra_valuecode", "nbpra_label", "nbpra_displayorder"], filter: anyOf("_nbpra_questiondef_value", defs.map((d) => d.nbpra_questiondefid)), orderBy: ["nbpra_displayorder asc"] }),
      revisionId ? t.query("nbpra_answers", { select: ["_nbpra_questiondef_value", "nbpra_isanswered", "nbpra_textvalue", "nbpra_booleanvalue", "nbpra_numbervalue", "nbpra_datevalue", "nbpra_optioncode"], filter: `_nbpra_sectionrevision_value eq ${revisionId}` }) : Promise.resolve([] as Row[]),
      // Uploaded and not replaced: upload status "Complete".
      revisionId ? t.query("nbpra_evidences", { select: ["nbpra_evidenceid", "_nbpra_questiondef_value", "nbpra_originalfilename", "nbpra_sizebytes", "nbpra_versionnumber", "nbpra_uploadedat"], filter: `_nbpra_sectionrevision_value eq ${revisionId} and nbpra_uploadstatus eq ${BASE + 1}` }) : Promise.resolve([] as Row[]),
    ]);
    const answerBy = byId(answers, "_nbpra_questiondef_value");
    const fileBy = byId(files, "_nbpra_questiondef_value");
    return defs.map((d): Question => {
      const type = (choice(d, "nbpra_answertype", L.answerType) || "Text") as AnswerType;
      const a = answerBy.get(d.nbpra_questiondefid);
      const file = fileBy.get(d.nbpra_questiondefid);
      let value = "";
      if (a?.nbpra_isanswered) {
        if (type === "Boolean") value = a.nbpra_booleanvalue === true ? "true" : a.nbpra_booleanvalue === false ? "false" : "";
        else if (type === "Number") value = a.nbpra_numbervalue === null || a.nbpra_numbervalue === undefined ? "" : String(a.nbpra_numbervalue);
        else if (type === "Date") value = (a.nbpra_datevalue ?? "").slice(0, 10);
        else if (type === "Choice") value = a.nbpra_optioncode ?? "";
        else value = a.nbpra_textvalue ?? "";
      }
      return {
        id: d.nbpra_questiondefid,
        code: d.nbpra_code,
        label: d.nbpra_label,
        type,
        required: d.nbpra_isrequired === true,
        options: options.filter((o) => o._nbpra_questiondef_value === d.nbpra_questiondefid).map((o) => ({ code: o.nbpra_valuecode, label: o.nbpra_label })),
        value,
        ...(type === "File"
          ? {
              accept: String(d.nbpra_validationrule ?? "").split(/[ ,]+/).filter(Boolean),
              file: file ? { id: file.nbpra_evidenceid, name: file.nbpra_originalfilename, sizeBytes: Number(file.nbpra_sizebytes ?? 0), version: file.nbpra_versionnumber ?? 1, uploadedAt: file.nbpra_uploadedat } : undefined,
            }
          : {}),
      };
    });
  }

  return {
    isSample: false,
    context,

    async listSubmissions() {
      const [subs, sections, ref, signed] = await Promise.all([
        t.query("nbpra_submissions", { select: SUB_SELECT, filter: "statecode eq 0" }),
        t.query("nbpra_sectioninstances", { select: SECTION_SELECT }),
        reference(),
        signatoryProgress(),
      ]);
      return subs.map((s) => toSubmission(s, sections, ref, signed.approved, signed.sponsors));
    },

    async getSubmission(id) {
      const [subs, sections, seats, defs, ref, requests, teams] = await Promise.all([
        t.query("nbpra_submissions", { select: SUB_SELECT, filter: `nbpra_submissionid eq ${id}` }),
        t.query("nbpra_sectioninstances", { select: SECTION_SELECT, filter: `_nbpra_submission_value eq ${id}` }),
        t.query("nbpra_signatories", { select: SEAT_SELECT, filter: `_nbpra_submission_value eq ${id} and nbpra_iscurrent eq true`, orderBy: ["nbpra_slotnumber asc"] }),
        t.query("nbpra_sectiondefs", { select: ["nbpra_sectiondefid", "nbpra_code", "nbpra_displayorder"] }),
        reference(),
        t.query("nbpra_approvalrequests", { select: ["nbpra_approvalrequestid", "nbpra_purpose", "nbpra_status", "nbpra_packagerevision", "_nbpra_sectionrevision_value", "_nbpra_reviewteam_value", "createdon"], filter: `_nbpra_submission_value eq ${id}` }),
        t.query("teams", { select: ["teamid", "name"] }),
      ]);
      if (!subs.length) return undefined;
      const row = subs[0];

      // Six seats: the sponsor from onboarding, then five the submitter fills in.
      const signatories: Signatory[] = Array.from({ length: SIGNATORY_SEATS }, (_, i) => {
        const p = seats.find((x) => x.nbpra_slotnumber === i + 1);
        if (!p) return { id: "", slot: i + 1, name: "", email: "", role: i === 0 ? "Business unit sponsor" : "", state: "Not requested" as DecisionState };
        return { id: p.nbpra_signatoryid, slot: i + 1, name: p.nbpra_displayname ?? p.nbpra_email ?? "", email: p.nbpra_email ?? "", role: p.nbpra_role ?? "", state: seatState(p), requestedAt: p.nbpra_requestedat ?? undefined, decidedAt: p.nbpra_decidedat ?? undefined, comment: p.nbpra_decisioncomment ?? undefined };
      });
      const sub = toSubmission(row, sections, ref, new Map([[id, signatories.filter((s) => s.state === "Approved").length]]), new Map([[id, signatories[0].name]]));

      const defById = byId(defs, "nbpra_sectiondefid");
      const teamById = byId(teams, "teamid");
      const order = (s: Row) => defById.get(s._nbpra_sectiondef_value)?.nbpra_displayorder ?? 0;
      const sectionRows: SectionSummary[] = sections
        .sort((a, b) => order(a) - order(b))
        .map((s) => {
          const status: SectionStatus = s.nbpra_isapplicable === false ? "Not Applicable" : (choice(s, "nbpra_status", L.section) as SectionStatus);
          const groups = requests
            .filter((r) => Number(r.nbpra_purpose) === PURPOSE.functional && r._nbpra_sectionrevision_value && r._nbpra_sectionrevision_value === s._nbpra_currentrevision_value)
            .map((r) => {
              const st = choice(r, "nbpra_status", L.approval);
              const state: DecisionState = st === "Approved" ? "Approved" : st === "Changes Requested" ? "Returned" : st === "Pending" ? "Pending" : "Not requested";
              return { name: teamById.get(r._nbpra_reviewteam_value)?.name ?? "Review group", state };
            });
          return { id: s.nbpra_sectioninstanceid, code: defById.get(s._nbpra_sectiondef_value)?.nbpra_code ?? s.nbpra_name, title: s.nbpra_name, status, revision: 0, answered: 0, required: 0, groups };
        });
      const heldSlot = ref.slots.get(row._nbpra_assignedslot_value) ?? ref.slots.get(ref.requests.get(row._nbpra_currentslotrequest_value)?._nbpra_requestedslot_value);
      const detail: SubmissionDetail = {
        ...sub,
        ownerId: row._nbpra_businessowner_value ?? "",
        adminNote: row.nbpra_adminnote ? { text: row.nbpra_adminnote, at: row.nbpra_adminnoteat, by: ref.users.get(row._nbpra_adminnoteby_value)?.fullname ?? "Administrator" } : undefined,
        meetingNote: (heldSlot && ref.meetings.get(heldSlot._nbpra_meeting_value)?.nbpra_updatenote) || undefined,
        sections: sectionRows,
        signatories,
        blockers: sub.blocker ? [sub.blocker] : [],
      };
      return detail;
    },

    async listEvents(submissionId) {
      const [rows, users, subs] = await Promise.all([
        t.query("nbpra_businessevents", {
          select: ["nbpra_businesseventid", "nbpra_occurredat", "nbpra_eventtype", "nbpra_action", "nbpra_oldstatus", "nbpra_newstatus", "nbpra_summary", "nbpra_channel", "nbpra_reason", "_nbpra_submission_value", "_nbpra_actor_value"],
          orderBy: ["nbpra_occurredat desc"],
          ...(submissionId ? { filter: `_nbpra_submission_value eq ${submissionId}` } : {}),
        }),
        t.query("systemusers", { select: ["systemuserid", "fullname"] }),
        t.query("nbpra_submissions", { select: ["nbpra_submissionid", "nbpra_reference"] }),
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
          eventType: choice(e, "nbpra_eventtype", L.eventType),
          action: e.nbpra_action ?? "",
          oldStatus: e.nbpra_oldstatus ?? undefined,
          newStatus: e.nbpra_newstatus ?? undefined,
          revision: e.nbpra_summary ?? undefined,
          channel: (choice(e, "nbpra_channel", L.channel) || "App") as Channel,
          reason: e.nbpra_reason ?? undefined,
        }),
      );
    },

    // ---- calendar and onboarding ----

    async listMeetings() {
      const [meetings, slots, committees, requests] = await Promise.all([
        t.query("nbpra_meetings", { select: ["nbpra_meetingid", "nbpra_name", "nbpra_startat", "nbpra_endat", "nbpra_status", "nbpra_requestopenat", "nbpra_requestcloseat", "nbpra_updatenote", "_nbpra_committee_value"], orderBy: ["nbpra_startat asc"] }),
        t.query("nbpra_slots", { select: ["nbpra_slotid", "nbpra_capacity", "nbpra_status", "_nbpra_meeting_value"], orderBy: ["nbpra_startat asc"] }),
        t.query("nbpra_committees", { select: ["nbpra_committeeid", "nbpra_name"] }),
        t.query("nbpra_slotrequests", { select: ["nbpra_status", "nbpra_allocationactive", "_nbpra_assignedslot_value"] }),
      ]);
      const committeeById = byId(committees, "nbpra_committeeid");
      // A place is taken once the administrator approves a request, not when it is submitted.
      const APPROVED_REQUEST = BASE + 2;
      const heldOn = (slotId: string) => requests.filter((r) => r._nbpra_assignedslot_value === slotId && Number(r.nbpra_status) === APPROVED_REQUEST && r.nbpra_allocationactive === true).length;
      const now = Date.now();
      return meetings
        .filter((m) => Date.parse(m.nbpra_startat) > now)
        .map((m): MeetingInfo => {
          const status = choice(m, "nbpra_status", L.meeting);
          const mine = slots.filter((s) => s._nbpra_meeting_value === m.nbpra_meetingid && choice(s, "nbpra_status", L.slot) === "Open");
          const capacity = mine.reduce((n, s) => n + (s.nbpra_capacity ?? 1), 0);
          const taken = mine.reduce((n, s) => n + heldOn(s.nbpra_slotid), 0);
          const withRoom = mine.find((s) => heldOn(s.nbpra_slotid) < (s.nbpra_capacity ?? 1));
          const remaining = Math.max(0, capacity - taken);
          const notYet = !!m.nbpra_requestopenat && Date.parse(m.nbpra_requestopenat) > now;
          const tooLate = !!m.nbpra_requestcloseat && Date.parse(m.nbpra_requestcloseat) < now;
          const closedReason = status !== "Open" ? status : capacity === 0 ? "Not open for requests" : remaining === 0 ? "Full" : notYet ? "Requests not open yet" : tooLate ? "Requests have closed" : undefined;
          return {
            id: m.nbpra_meetingid,
            name: m.nbpra_name,
            committee: committeeById.get(m._nbpra_committee_value)?.nbpra_name ?? "",
            startAt: m.nbpra_startat,
            endAt: m.nbpra_endat,
            status,
            requestCloseAt: m.nbpra_requestcloseat ?? undefined,
            slotId: (withRoom ?? mine[0])?.nbpra_slotid ?? "",
            capacity,
            taken,
            remaining,
            requestable: !closedReason && !!withRoom,
            closedReason,
            note: m.nbpra_updatenote || undefined,
          };
        });
    },

    async searchPeople(term) {
      const q = term.trim();
      return q.length < 2 ? [] : t.searchPeople(q);
    },

    async getIntake(submissionId): Promise<Intake> {
      const [subs, requests, seats] = await Promise.all([
        t.query("nbpra_submissions", { select: ["nbpra_title", "nbpra_businessarea", "nbpra_proposaltype", "nbpra_summary", "nbpra_scope", "_nbpra_sponsor_value", "_nbpra_copiedfrom_value"], filter: `nbpra_submissionid eq ${submissionId}` }),
        t.query("nbpra_slotrequests", { select: ["nbpra_status", "nbpra_revisionnumber", "_nbpra_requestedslot_value"], filter: `_nbpra_submission_value eq ${submissionId}`, orderBy: ["nbpra_revisionnumber desc"] }),
        t.query("nbpra_signatories", { select: ["nbpra_displayname", "nbpra_email", "nbpra_directoryid"], filter: `_nbpra_submission_value eq ${submissionId} and nbpra_iscurrent eq true and nbpra_slotnumber eq 1` }),
      ]);
      const s = subs[0] ?? {};
      const request = requests.find((r) => Number(r.nbpra_status) === SLOT_REQUEST_DRAFT) ?? requests[0];
      const sponsor: Person | null = seats[0] ? { id: seats[0].nbpra_directoryid ?? "", name: seats[0].nbpra_displayname ?? seats[0].nbpra_email, email: seats[0].nbpra_email } : null;
      const source = s._nbpra_copiedfrom_value ? await t.query("nbpra_submissions", { select: ["nbpra_reference"], filter: `nbpra_submissionid eq ${s._nbpra_copiedfrom_value}` }) : [];
      return { copiedFrom: source[0]?.nbpra_reference, title: s.nbpra_title ?? "", businessArea: s.nbpra_businessarea ?? "", proposalType: s.nbpra_proposaltype ?? "", summary: s.nbpra_summary ?? "", scope: s.nbpra_scope ?? "", sponsor, slotId: request?._nbpra_requestedslot_value ?? "" };
    },

    async saveOnboarding(submissionId, intake) {
      const { copiedFrom: _readOnly, sponsor, ...fields } = intake;
      const body = { ...fields, sponsor: sponsor ? { name: sponsor.name, email: sponsor.email, directoryId: sponsor.id } : undefined };
      return result(await t.workflow("saveOnboarding", submissionId, undefined, undefined, JSON.stringify(body)), (d) => d);
    },
    async submitOnboarding(submissionId) {
      return plain(await t.workflow("submitOnboarding", submissionId));
    },

    // ---- checklist ----

    async getSection(sectionId): Promise<SectionDetail | undefined> {
      const rows = await t.query("nbpra_sectioninstances", { select: SECTION_SELECT, filter: `nbpra_sectioninstanceid eq ${sectionId}` });
      const inst = rows[0];
      if (!inst) return undefined;
      const status = choice(inst, "nbpra_status", L.section) as SectionStatus;
      const revisionId: string | undefined = inst._nbpra_currentrevision_value ?? undefined;
      const [questions, revisions] = await Promise.all([
        questionsWithAnswers(inst._nbpra_sectiondef_value, revisionId),
        revisionId ? t.query("nbpra_sectionrevisions", { select: ["nbpra_revisionnumber"], filter: `nbpra_sectionrevisionid eq ${revisionId}` }) : Promise.resolve([] as Row[]),
      ]);
      let returnedReason: string | undefined;
      if (status === "Changes Requested" && revisionId) {
        const returned = await t.query("nbpra_approvalrequests", { select: ["nbpra_approvalrequestid"], filter: `_nbpra_sectionrevision_value eq ${revisionId} and nbpra_status eq ${BASE + 2}` });
        if (returned.length) {
          const decisions = await t.query("nbpra_approvaldecisions", { select: ["nbpra_comment"], filter: anyOf("_nbpra_approvalrequest_value", returned.map((r) => r.nbpra_approvalrequestid)) });
          returnedReason = decisions.map((d) => d.nbpra_comment).filter(Boolean).join(" · ") || undefined;
        }
      }
      return { id: sectionId, title: inst.nbpra_name, status, revision: revisions[0]?.nbpra_revisionnumber ?? 0, editable: ["Not Started", "Draft", "Ready to Submit", "Changes Requested"].includes(status), questions, returnedReason };
    },

    async saveSection(sectionId, answers) {
      return result(await t.workflow("saveSection", sectionId, undefined, undefined, JSON.stringify(answers)), (d) => d);
    },
    async submitSection(sectionId) {
      return plain(await t.workflow("submitSection", sectionId));
    },

    // ---- evidence, memo and reuse ----

    async uploadEvidence(sectionId, questionId, file) {
      return result(await t.workflow("uploadEvidence", sectionId, undefined, undefined, JSON.stringify({ q: questionId, ...file })), (d) => d);
    },
    async downloadFile(kind, id) {
      return result(await t.workflow(kind === "evidence" ? "downloadEvidence" : "downloadExport", id), (d) => JSON.parse(d) as FileContent);
    },
    async listExports(submissionId): Promise<ExportInfo[]> {
      const [rows, users] = await Promise.all([
        t.query("nbpra_exportpackages", { select: ["nbpra_exportpackageid", "nbpra_filename", "nbpra_exporttype", "nbpra_generatedat", "_nbpra_requestedby_value", "nbpra_status"], filter: `_nbpra_submission_value eq ${submissionId} and nbpra_status eq ${BASE + 1}`, orderBy: ["nbpra_generatedat desc"] }),
        t.query("systemusers", { select: ["systemuserid", "fullname"] }),
      ]);
      const userById = byId(users, "systemuserid");
      return rows.map((r) => ({ id: r.nbpra_exportpackageid, fileName: r.nbpra_filename ?? "memo.pdf", type: choice(r, "nbpra_exporttype", L.exportType), generatedAt: r.nbpra_generatedat, requestedBy: userById.get(r._nbpra_requestedby_value)?.fullname ?? "" }));
    },
    async saveMemo(submissionId, fileName, base64) {
      return result(await t.workflow("saveExport", submissionId, undefined, undefined, JSON.stringify({ fileName, base64 })), (d) => d);
    },
    async copySubmission(submissionId) {
      return result(await t.workflow("copySubmission", submissionId), (d) => d);
    },

    // ---- functional review and signatories ----

    async listReviewTasks(): Promise<ReviewTask[]> {
      const requests = await t.query("nbpra_approvalrequests", { select: ["nbpra_approvalrequestid", "_nbpra_submission_value", "_nbpra_sectionrevision_value", "_nbpra_reviewteam_value", "createdon"], filter: `nbpra_purpose eq ${PURPOSE.functional} and nbpra_status eq ${PENDING}`, orderBy: ["createdon asc"] });
      if (!requests.length) return [];
      const [subs, revisions, instances, teams] = await Promise.all([
        t.query("nbpra_submissions", { select: ["nbpra_submissionid", "nbpra_reference", "nbpra_name"] }),
        t.query("nbpra_sectionrevisions", { select: ["nbpra_sectionrevisionid", "nbpra_revisionnumber", "_nbpra_sectioninstance_value"], filter: anyOf("nbpra_sectionrevisionid", [...new Set(requests.map((r) => r._nbpra_sectionrevision_value))]) }),
        t.query("nbpra_sectioninstances", { select: ["nbpra_sectioninstanceid", "nbpra_name"] }),
        t.query("teams", { select: ["teamid", "name"] }),
      ]);
      const subById = byId(subs, "nbpra_submissionid");
      const revById = byId(revisions, "nbpra_sectionrevisionid");
      const instById = byId(instances, "nbpra_sectioninstanceid");
      const teamById = byId(teams, "teamid");
      return requests.map((r) => {
        const rev = revById.get(r._nbpra_sectionrevision_value);
        const sub = subById.get(r._nbpra_submission_value);
        return {
          requestId: r.nbpra_approvalrequestid,
          submissionId: r._nbpra_submission_value,
          reference: sub?.nbpra_reference ?? "",
          title: sub?.nbpra_name ?? "",
          section: `${instById.get(rev?._nbpra_sectioninstance_value)?.nbpra_name ?? "Section"} · rev ${rev?.nbpra_revisionnumber ?? 1}`,
          team: teamById.get(r._nbpra_reviewteam_value)?.name ?? "Review group",
          requestedAt: r.createdon,
        };
      });
    },

    async getReview(requestId): Promise<ReviewDetail | undefined> {
      const task = (await this.listReviewTasks()).find((x) => x.requestId === requestId);
      if (!task) return undefined;
      const [req] = await t.query("nbpra_approvalrequests", { select: ["_nbpra_sectionrevision_value"], filter: `nbpra_approvalrequestid eq ${requestId}` });
      const [rev] = await t.query("nbpra_sectionrevisions", { select: ["_nbpra_sectioninstance_value"], filter: `nbpra_sectionrevisionid eq ${req._nbpra_sectionrevision_value}` });
      const [inst] = await t.query("nbpra_sectioninstances", { select: ["_nbpra_sectiondef_value"], filter: `nbpra_sectioninstanceid eq ${rev._nbpra_sectioninstance_value}` });
      const questions = await questionsWithAnswers(inst._nbpra_sectiondef_value, req._nbpra_sectionrevision_value);
      const shown = (q: Question) => {
        if (q.type === "File") return q.file ? q.file.name : "No file uploaded";
        if (!q.value) return "Not answered";
        if (q.type === "Boolean") return q.value === "true" ? "Yes" : "No";
        if (q.type === "Choice") return q.options.find((o) => o.code === q.value)?.label ?? q.value;
        return q.value;
      };
      return { ...task, answers: questions.map((q) => ({ label: q.label, value: shown(q), fileId: q.file?.id })) };
    },

    async decideReview(requestId, outcome, comment) {
      return plain(await t.workflow("decideReview", requestId, outcome, comment));
    },
    async setSignatory(submissionId, seat, person, role) {
      return result(await t.workflow("setSignatory", submissionId, undefined, undefined, JSON.stringify({ seat, name: person.name, email: person.email, directoryId: person.id, role })), (d) => d);
    },
    async sendSignatory(signatoryId) {
      return plain(await t.workflow("sendSignatory", signatoryId));
    },

    async listSignatoryTasks(): Promise<SignatoryTask[]> {
      // Matched on directory id as well as email: a user's address in Dataverse can differ from their mailbox.
      const { email, directoryId } = await context();
      const me = [email && `nbpra_email eq '${email.replace(/'/g, "''")}'`, directoryId && `nbpra_directoryid eq '${directoryId}'`].filter(Boolean);
      if (!me.length) return [];
      const mine = await t.query("nbpra_signatories", { select: SEAT_SELECT, filter: `nbpra_iscurrent eq true and nbpra_status eq ${BASE + 1} and (${me.join(" or ")})` });
      if (!mine.length) return [];
      const subById = byId(await t.query("nbpra_submissions", { select: ["nbpra_submissionid", "nbpra_reference", "nbpra_name"] }), "nbpra_submissionid");
      return mine
        .map((a) => {
          const sub = subById.get(a._nbpra_submission_value);
          return { signatoryId: a.nbpra_signatoryid, submissionId: a._nbpra_submission_value, reference: sub?.nbpra_reference ?? "", title: sub?.nbpra_name ?? "", role: a.nbpra_role || "Signatory", requestedAt: a.nbpra_requestedat ?? undefined };
        })
        .sort((a, b) => a.reference.localeCompare(b.reference));
    },

    async decideSignatory(signatoryId, outcome, comment) {
      return plain(await t.workflow("decideSignatory", signatoryId, outcome, comment));
    },
    async finalSubmit(submissionId) {
      return plain(await t.workflow("finalSubmit", submissionId));
    },

    async postNote(submissionId, text) {
      return plain(await t.workflow("postNote", submissionId, undefined, text));
    },

    async decide(submissionId, action, comment): Promise<ActionResult> {
      const r = await t.adminDecision(submissionId, action, comment);
      return r.Outcome === "accepted" ? { ok: true } : { ok: false, error: r.Message || "The decision was not recorded." };
    },
  };
}
