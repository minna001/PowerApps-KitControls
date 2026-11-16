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
const free = slots.filter((s) => s.nbpra_meeting?.nbpra_status === B + 1 && (s.nbpra_activeallocationcount ?? 0) < s.nbpra_capacity);
const [slot, secondSlot] = free;
if (!secondSlot) throw new Error("Needs two free slots in an open meeting; run seed.mjs.");

const title = `Journey test ${new Date().toISOString().slice(0, 16)}`;
const id = expect("create draft", await wf("saveOnboarding", "", { Payload: JSON.stringify({ title }) }), "accepted").Data;
expect("submit incomplete onboarding", await wf("submitOnboarding", id), "validation_failed");
const intake = { title, businessArea: "Payments", proposalType: "New product", summary: "Automated journey test.", scope: "United States", sponsor: { name: me.fullName, email: me.email }, slotId: slot.nbpra_slotid };
if (!me.email) throw new Error("The signed-in user has no email address, so cannot stand in as a signatory.");
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
  const plain = qs.filter((q) => q.nbpra_answertype !== FILE);
  return (onlyFirst ? plain.slice(0, 1) : plain).map((q) => ({ q: q.nbpra_questiondefid, v: value(q.nbpra_answertype) }));
};
const FILE = B + 9;
const fileQuestions = async (s) => (await api("GET", `nbpra_questiondefs?$select=nbpra_code&$filter=_nbpra_sectiondef_value eq ${s._nbpra_sectiondef_value} and nbpra_answertype eq ${FILE}`)).value;
const workbook = Buffer.from("journey test workbook " + Date.now()).toString("base64");
let evidenceId;

const first = sections[0];
const partial = expect("save one answer", await wf("saveSection", first.nbpra_sectioninstanceid, { Payload: JSON.stringify(await answersFor(first, true)) }), "accepted");
console.log(`     section status after a partial save: ${partial.Data}`);
expect("submit incomplete section", await wf("submitSection", first.nbpra_sectioninstanceid), "validation_failed");
let uploads = 0;
for (const s of sections) {
  const files = await fileQuestions(s);
  const r = await wf("saveSection", s.nbpra_sectioninstanceid, { Payload: JSON.stringify(await answersFor(s)) });
  const want = files.length ? "Draft" : "Ready to Submit";
  if (r.Outcome !== "accepted" || r.Data !== want) expect(`save ${s.nbpra_name}`, { ...r, Outcome: r.Outcome === "accepted" ? `accepted but ${r.Data}, wanted ${want}` : r.Outcome }, "accepted");
  for (const q of files) {
    if (!uploads) {
      expect(`submit ${s.nbpra_name} without its required file`, await wf("submitSection", s.nbpra_sectioninstanceid), "validation_failed");
      expect("upload a file of the wrong type", await wf("uploadEvidence", s.nbpra_sectioninstanceid, { Payload: JSON.stringify({ q: q.nbpra_questiondefid, fileName: "notes.pdf", contentType: "application/pdf", base64: workbook }) }), "validation_failed");
    }
    const up = expect(`upload ${q.nbpra_code}`, await wf("uploadEvidence", s.nbpra_sectioninstanceid, { Payload: JSON.stringify({ q: q.nbpra_questiondefid, fileName: `${q.nbpra_code}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", base64: workbook }) }), "accepted");
    evidenceId ??= up.Data;
    uploads++;
  }
  const sub = await wf("submitSection", s.nbpra_sectioninstanceid);
  if (sub.Outcome !== "accepted") expect(`submit ${s.nbpra_name}`, sub, "accepted");
}
console.log(`ok   saved and submitted all ${sections.length} sections (No and 0 answers counted as answered; ${uploads} required files uploaded)`);
if (evidenceId) {
  const d = expect("download the uploaded file", await wf("downloadEvidence", evidenceId), "accepted");
  const same = d.Data && JSON.parse(d.Data).base64 === workbook;
  if (!same) failures++;
  console.log(`${same ? "ok  " : "FAIL"} downloaded file matches what was uploaded`);
} else {
  failures++;
  console.log("FAIL no evidence questions found; run seed-checklist.mjs");
}
expect("edit a section under review", await wf("saveSection", first.nbpra_sectioninstanceid, { Payload: "[]" }), "validation_failed");

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

// Signatories: the sponsor from onboarding plus five picked from the directory, each asked on their own.
const seatRows = async () => (await api("GET", `nbpra_signatories?$select=nbpra_slotnumber,nbpra_status,nbpra_displayname&$filter=_nbpra_submission_value eq ${id} and nbpra_iscurrent eq true&$orderby=nbpra_slotnumber asc`)).value;
let seats = await seatRows();
console.log(`${seats.length === 1 && seats[0].nbpra_slotnumber === 1 ? "ok  " : (failures++, "FAIL")} only the sponsor is named before the submitter picks the rest (${seats.length})`);
expect("final submit before signatories", await wf("finalSubmit", id), "validation_failed");
const pick = (seat, role, email = me.email) => wf("setSignatory", id, { Payload: JSON.stringify({ seat, role, name: me.fullName, email }) });
expect("seat outside one to six", await pick(7, "Legal"), "validation_failed");
expect("person without an email address", await pick(2, "Legal", "nobody"), "validation_failed");
for (const [i, role] of ["Business risk", "Enterprise risk", "Compliance", "Legal", "Finance"].entries()) {
  const r = await pick(i + 2, role);
  if (r.Outcome !== "accepted") expect(`choose signatory for ${role}`, r, "accepted");
}
seats = await seatRows();
console.log(`${seats.length === 6 ? "ok  " : (failures++, "FAIL")} six signatories named (${seats.length})`);
expect("record an answer before asking", await wf("decideSignatory", seats[1].nbpra_signatoryid, { Outcome: "approve" }), "validation_failed");
for (const s of seats) {
  const r = await wf("sendSignatory", s.nbpra_signatoryid);
  if (r.Outcome !== "accepted") expect(`ask signatory ${s.nbpra_slotnumber}`, r, "accepted");
}
expect("ask the same signatory twice", await wf("sendSignatory", seats[0].nbpra_signatoryid), "already_resolved");
// What the approval flow sends back: the outcome plus who responded.
const viaFlow = (s, Outcome, responder, Comment = "") => wf("decideSignatory", s.nbpra_signatoryid, { Outcome, Comment, Payload: JSON.stringify({ responder }) });
expect("response from someone other than the signatory", await viaFlow(seats[1], "approve", "someone.else@example.com"), "unauthorized");
expect("return without a reason", await viaFlow(seats[1], "return", me.email), "validation_failed");
expect("signatory returns the package", await viaFlow(seats[1], "return", me.email, "Numbers need updating."), "accepted");
expect("answer the same request again", await viaFlow(seats[1], "approve", me.email), "already_resolved");
expect("ask the returning signatory again", await wf("sendSignatory", seats[1].nbpra_signatoryid), "accepted");
for (const [i, s] of seats.entries()) {
  const d = i % 2 ? await viaFlow(s, "approve", me.email.toUpperCase()) : await wf("decideSignatory", s.nbpra_signatoryid, { Outcome: "approve" });
  if (i === 4) console.log(`     after five approvals: ${await statusOf(id)} — ${d.Message}`);
  if (d.Outcome !== "accepted") expect(`signatory ${i + 1}`, d, "accepted");
}
console.log(`ok   ${seats.length} signatory approvals recorded; status ${await statusOf(id)}`);
expect("final submit", await wf("finalSubmit", id), "accepted");
expect("Kate authorizes committee attendance", await admin(id, "authorize"), "accepted");

// Committee memo: stored as a PDF in the submission's export history.
expect("save a non-PDF as the memo", await wf("saveExport", id, { Payload: JSON.stringify({ fileName: "memo.pdf", base64: workbook }) }), "validation_failed");
const pdf = Buffer.from("%PDF-1.4\n% journey test memo\n").toString("base64");
const memo = expect("save the committee memo", await wf("saveExport", id, { Payload: JSON.stringify({ fileName: "memo.pdf", base64: pdf }) }), "accepted");
const back2 = await wf("downloadExport", memo.Data);
console.log(`${back2.Data && JSON.parse(back2.Data).base64 === pdf ? "ok  " : (failures++, "FAIL")} memo downloads unchanged`);

// Start from an earlier submission: content is copied, approvals, files and signatories are not.
const copyId = expect("start a new draft from this submission", await wf("copySubmission", id), "accepted").Data;
const copy = await api("GET", `nbpra_submissions(${copyId})?$select=nbpra_title,nbpra_businessarea,nbpra_summary`);
console.log(`     copy is "${copy.nbpra_title}" in ${copy.nbpra_businessarea}`);
const copySeats = (await api("GET", `nbpra_signatories?$select=nbpra_slotnumber&$filter=_nbpra_submission_value eq ${copyId} and nbpra_iscurrent eq true`)).value.length;
console.log(`${copySeats === 0 ? "ok  " : (failures++, "FAIL")} copy starts with no signatories (${copySeats})`);
expect("submit the copy without slot or signatories", await wf("submitOnboarding", copyId), "validation_failed");
expect("complete the copy's onboarding", await wf("saveOnboarding", copyId, { Payload: JSON.stringify({ ...intake, title: copy.nbpra_title, slotId: secondSlot.nbpra_slotid }) }), "accepted");
expect("submit the copy", await wf("submitOnboarding", copyId), "accepted");
expect("Kate approves the copy", await admin(copyId, "approveOnboarding"), "accepted");
const copied = (await api("GET", `nbpra_sectioninstances?$select=nbpra_name,nbpra_status&$filter=_nbpra_submission_value eq ${copyId}`)).value;
const ready = copied.filter((x) => x.nbpra_status === B + 2).length;
const draft = copied.filter((x) => x.nbpra_status === B + 1).length;
const okPrefill = ready + draft === copied.length && draft === uploads;
if (!okPrefill) failures++;
console.log(`${okPrefill ? "ok  " : "FAIL"} copy's checklist is prefilled: ${ready} sections ready to submit, ${draft} still need their file, of ${copied.length}`);
const copyEvidence = (await api("GET", `nbpra_evidences?$select=nbpra_name&$filter=_nbpra_submission_value eq ${copyId}`)).value.length;
console.log(`${copyEvidence === 0 ? "ok  " : (failures++, "FAIL")} no files were copied (${copyEvidence})`);

const final = await statusOf(id);
const events = (await api("GET", `nbpra_businessevents?$select=nbpra_action&$filter=_nbpra_submission_value eq ${id}`)).value.length;
if (final !== "Authorized for Committee") failures++;
console.log(`\nFinal status: ${final}. Timeline events written: ${events}. ${failures ? failures + " check(s) FAILED" : "All checks passed"}.`);
process.exit(failures ? 1 : 0);
