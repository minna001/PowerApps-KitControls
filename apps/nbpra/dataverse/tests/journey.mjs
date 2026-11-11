#!/usr/bin/env node
// End-to-end server test: drives one new submission from draft to Authorized
// for Committee through the custom APIs, checking refusals along the way.
// It CREATES a real submission ("Journey test …") in the target environment.
// Needs the sample calendar and checklist (seed.mjs, seed-checklist.mjs) and,
// with a single user, the test switches (register.mjs --single-user-test).
//
//   node tests/journey.mjs --url https://<org>.crm.dynamics.com
import { connect } from "../dv.mjs";

const args = process.argv.slice(2);
const urlArg = args[args.indexOf("--url") + 1];
if (!args.includes("--url") || !urlArg) {
  console.error("Pass --url https://<org>.crm.dynamics.com");
  process.exit(1);
}
const { api } = connect(urlArg);
const B = 774100000;
let failures = 0;

async function wf(Operation, TargetId = "", extra = {}) {
  try {
    return await api("POST", "nbpra_Workflow", { Operation, TargetId, ...extra });
  } catch (e) {
    return { Outcome: "error", Message: e.message.split("\n")[1]?.slice(0, 200) ?? e.message };
  }
}
async function admin(SubmissionId, Action, Comment = "") {
  try {
    return await api("POST", "nbpra_AdminDecision", { SubmissionId, Action, Comment, Channel: "App" });
  } catch (e) {
    return { Outcome: "error", Message: e.message.split("\n")[1]?.slice(0, 200) ?? e.message };
  }
}
function expect(label, r, outcome) {
  const ok = r.Outcome === outcome;
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${r.Outcome}${ok ? "" : ` (wanted ${outcome})`} — ${r.Message}`);
  return r;
}
const statusOf = async (id) => (await api("GET", `nbpra_submissions(${id})?$select=nbpra_status`, undefined, { headers: { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' } }))["nbpra_status@OData.Community.Display.V1.FormattedValue"];

const me = JSON.parse(expect("context", await wf("context"), "accepted").Data);
console.log(`     acting as ${me.fullName}${me.isAdmin ? " (administrator)" : ""}`);

// A requestable slot with free capacity in a future open meeting.
const slots = (await api("GET", `nbpra_slots?$select=nbpra_slotreference,nbpra_activeallocationcount,nbpra_capacity&$filter=nbpra_status eq ${B} and nbpra_startat gt ${new Date().toISOString()}&$orderby=nbpra_startat desc&$expand=nbpra_meeting($select=nbpra_status)`)).value;
const slot = slots.find((s) => s.nbpra_meeting?.nbpra_status === B + 1 && (s.nbpra_activeallocationcount ?? 0) < s.nbpra_capacity);
if (!slot) throw new Error("No free slot in an open meeting; run seed.mjs.");

const title = `Journey test ${new Date().toISOString().slice(0, 16)}`;
const id = expect("create draft", await wf("saveOnboarding", "", { Payload: JSON.stringify({ title }) }), "accepted").Data;
expect("submit incomplete onboarding", await wf("submitOnboarding", id), "validation_failed");
const intake = { title, businessArea: "Payments", proposalType: "New product", summary: "Automated journey test.", scope: "United States", sponsorId: me.userId, slotId: slot.nbpra_slotid, signatories: Array(5).fill(me.userId) };
expect("save full onboarding", await wf("saveOnboarding", id, { Payload: JSON.stringify(intake) }), "accepted");
expect("save checklist before approval", await wf("saveSection", "00000000-0000-0000-0000-000000000001", { Payload: "[]" }), "validation_failed");
expect("submit onboarding", await wf("submitOnboarding", id), "accepted");
expect("submit onboarding twice", await wf("submitOnboarding", id), "already_resolved");
expect("Kate approves onboarding", await admin(id, "approveOnboarding", "Journey test"), "accepted");

const sections = (await api("GET", `nbpra_sectioninstances?$select=nbpra_name,_nbpra_sectiondef_value&$filter=_nbpra_submission_value eq ${id}&$expand=nbpra_sectiondef($select=nbpra_displayorder)`)).value.sort((a, b) => a.nbpra_sectiondef.nbpra_displayorder - b.nbpra_sectiondef.nbpra_displayorder);
console.log(`     checklist unlocked with ${sections.length} sections`);
const answersFor = async (s, onlyFirst = false) => {
  const qs = (await api("GET", `nbpra_questiondefs?$select=nbpra_answertype,nbpra_isrequired&$filter=_nbpra_sectiondef_value eq ${s._nbpra_sectiondef_value}&$orderby=nbpra_displayorder&$expand=nbpra_questiondef_nbpra_questionoption_questiondef($select=nbpra_valuecode)`).catch(async () => api("GET", `nbpra_questiondefs?$select=nbpra_answertype,nbpra_isrequired&$filter=_nbpra_sectiondef_value eq ${s._nbpra_sectiondef_value}&$orderby=nbpra_displayorder`))).value;
  const value = (t) => ({ [B + 2]: "false", [B + 5]: "0", [B + 6]: "0", [B + 7]: "2027-03-01", [B + 3]: "LOW" })[t] ?? "Journey test answer.";
  return (onlyFirst ? qs.slice(0, 1) : qs).map((q) => ({ q: q.nbpra_questiondefid, v: value(q.nbpra_answertype) }));
};

const first = sections[0];
const partial = expect("save one answer", await wf("saveSection", first.nbpra_sectioninstanceid, { Payload: JSON.stringify(await answersFor(first, true)) }), "accepted");
console.log(`     section status after a partial save: ${partial.Data}`);
expect("submit incomplete section", await wf("submitSection", first.nbpra_sectioninstanceid), "validation_failed");
for (const s of sections) {
  const r = await wf("saveSection", s.nbpra_sectioninstanceid, { Payload: JSON.stringify(await answersFor(s)) });
  if (r.Outcome !== "accepted" || r.Data !== "Ready to Submit") expect(`save ${s.nbpra_name}`, { ...r, Outcome: r.Outcome === "accepted" ? `accepted but ${r.Data}` : r.Outcome }, "accepted");
  const sub = await wf("submitSection", s.nbpra_sectioninstanceid);
  if (sub.Outcome !== "accepted") expect(`submit ${s.nbpra_name}`, sub, "accepted");
}
console.log(`ok   saved and submitted all ${sections.length} sections (No and 0 answers counted as answered)`);
expect("edit a section under review", await wf("saveSection", first.nbpra_sectioninstanceid, { Payload: "[]" }), "validation_failed");
expect("request signatories too early", await wf("requestSignatories", id), "validation_failed");

const pending = async () => (await api("GET", `nbpra_approvalrequests?$select=nbpra_name,_nbpra_sectionrevision_value&$filter=_nbpra_submission_value eq ${id} and nbpra_purpose eq ${B + 1} and nbpra_status eq ${B}`)).value;
let reviews = await pending();
expect("request changes without a reason", await wf("decideReview", reviews[0].nbpra_approvalrequestid, { Outcome: "changes" }), "validation_failed");
const returned = reviews[0];
expect("reviewer requests changes", await wf("decideReview", returned.nbpra_approvalrequestid, { Outcome: "changes", Comment: "Please expand the description." }), "accepted");
expect("decide the same review again", await wf("decideReview", returned.nbpra_approvalrequestid, { Outcome: "approve" }), "already_resolved");
const back = (await api("GET", `nbpra_sectioninstances?$select=nbpra_name,_nbpra_sectiondef_value&$filter=_nbpra_submission_value eq ${id} and nbpra_status eq ${B + 4}`)).value[0];
expect(`resave returned section (${back.nbpra_name})`, await wf("saveSection", back.nbpra_sectioninstanceid, { Payload: JSON.stringify(await answersFor(back)) }), "accepted");
expect("resubmit as revision 2", await wf("submitSection", back.nbpra_sectioninstanceid), "accepted");
reviews = await pending();
for (const r of reviews) {
  const d = await wf("decideReview", r.nbpra_approvalrequestid, { Outcome: "approve" });
  if (d.Outcome !== "accepted") expect(`approve ${r.nbpra_name}`, d, "accepted");
}
console.log(`ok   approved ${reviews.length} functional reviews`);

expect("request signatories", await wf("requestSignatories", id), "accepted");
expect("final submit before signatories", await wf("finalSubmit", id), "validation_failed");
const seats = (await api("GET", `nbpra_approvalassignments?$select=nbpra_name&$filter=nbpra_status eq ${B} and _nbpra_signatoryassignment_value ne null&$expand=nbpra_approvalrequest($select=_nbpra_submission_value)`)).value.filter((a) => a.nbpra_approvalrequest?._nbpra_submission_value === id);
for (const [i, a] of seats.entries()) {
  const d = await wf("decideSignatory", a.nbpra_approvalassignmentid, { Outcome: "approve" });
  if (i === 3) console.log(`     after four approvals: ${await statusOf(id)} — ${d.Message}`);
  if (d.Outcome !== "accepted") expect(`signatory ${i + 1}`, d, "accepted");
}
console.log(`ok   ${seats.length} signatory approvals recorded; status ${await statusOf(id)}`);
expect("final submit", await wf("finalSubmit", id), "accepted");
expect("Kate authorizes committee attendance", await admin(id, "authorize"), "accepted");

const final = await statusOf(id);
const events = (await api("GET", `nbpra_businessevents?$select=nbpra_action&$filter=_nbpra_submission_value eq ${id}`)).value.length;
if (final !== "Authorized for Committee") failures++;
console.log(`\nFinal status: ${final}. Timeline events written: ${events}. ${failures ? failures + " check(s) FAILED" : "All checks passed"}.`);
process.exit(failures ? 1 : 0);
