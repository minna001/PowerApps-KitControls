#!/usr/bin/env node
// Writes sample data as CSV files for manual import through the NBPRA Admin app
// (open a table, then Import from Excel / Import from CSV). Use it where scripts
// cannot be run against the environment. Everything is invented.
//
// Column headers are the columns' display names (see labels.mjs). Lookup columns hold the NAME of
// the row they point at, which is how the import matches them, so every name in
// a file that others refer to is unique. Files are numbered in import order.
// Dates are written relative to today so meetings are in the future.
//
//   node sample-csv.mjs --out <folder>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { columnLabel } from "./labels.mjs";

const schema = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.json"), "utf8"));

const args = process.argv.slice(2);
const out = args[args.indexOf("--out") + 1];
if (!args.includes("--out") || !out) {
  console.error("Pass --out <folder>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const DAY = 86400000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const cell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Writes one table's file. `columns` are schema column names; the file is named after the table's display name. */
function write(order, tableName, columns, rows) {
  const table = schema.tables.find((t) => t.name === tableName);
  for (const c of columns) if (c !== "name" && !table.columns.some((x) => x[0] === c)) throw new Error(`${tableName} has no column ${c}`);
  const headers = columns.map((c) => (c === "name" ? "Name" : columnLabel(table.display, c)));
  const file = `${order} ${table.display}.csv`;
  // UTF-8 with a byte-order mark so Excel reads accented characters correctly.
  writeFileSync(join(out, file), "\uFEFF" + [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n");
  console.log(`${file}: ${rows.length} rows`);
}

// ---- calendar -----------------------------------------------------------------
const COMMITTEE = "New Business and Product Risk Committee";
write("01", "committee", ["name", "code", "description", "defaulttimezone", "isactive"], [[COMMITTEE, "NBPRC", "Sample committee.", "Eastern Standard Time", "Yes"]]);

// Three open meetings on Wednesdays 3, 5 and 9 weeks out, and one canceled.
const nextWed = (weeks) => {
  const d = new Date(NOW + weeks * 7 * DAY);
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  d.setUTCHours(15, 0, 0, 0);
  return d.getTime();
};
const MEETINGS = [
  [nextWed(2), "Canceled", "Committee quorum not available."],
  [nextWed(3), "Open"],
  [nextWed(5), "Open"],
  [nextWed(9), "Open"],
];
const meetingName = (t) => `NBPRC ${iso(t).slice(0, 10)}`;
write("02", "meeting", ["name", "committee", "startat", "endat", "timezone", "requestopenat", "requestcloseat", "submissiondeadlineat", "status", "cancellationreason"],
  MEETINGS.map(([t, status, reason]) => [meetingName(t), COMMITTEE, iso(t), iso(t + 3600000), "Eastern Standard Time", iso(NOW - 30 * DAY), iso(t - 7 * DAY), iso(t - 3 * DAY), status, reason ?? ""]),
);

const slotName = (t, n) => `NBPRC-${iso(t).slice(0, 10).replace(/-/g, "")}-${String(n).padStart(2, "0")}`;
// Which sample submission holds which slot: [meeting index, slot number].
const SUBS = [
  // title, area, type, status, slot [meeting, n] or null, sections approved, age days
  ["Tokenised Deposit Pilot", "Global Markets", "New product", "Onboarding Draft", null, 0, 6],
  ["Corporate Card Virtual Issuance", "Commercial Banking", "New product", "Awaiting Onboarding Review", [2, 3], 0, 9],
  ["Carbon Credit Custody", "Global Markets", "New business", "Awaiting Onboarding Review", [2, 3], 0, 3],
  ["Instant Payee Verification", "Payments", "Material change", "Onboarding Denied", [1, 9], 0, 12],
  ["SME Overdraft Repricing", "Retail Banking", "Material change", "Checklist in Progress", [1, 4], 2, 31],
  ["Crypto Custody Staking Extension", "Global Markets", "Product extension", "Awaiting Signatory Approval", [1, 5], 9, 142],
  ["Green Mortgage Rate Discount", "Retail Banking", "New product", "Ready for Final Submission", [1, 6], 9, 58],
  ["Supplier Finance Onboarding Portal", "Commercial Banking", "New business", "Awaiting Final Admin Review", [1, 7], 9, 71],
  ["Private Credit Feeder Fund", "Wealth", "New product", "Awaiting Final Admin Review", [0, 2], 9, 102],
  ["Real-Time FX Rate Lock", "Payments", "Product extension", "Authorized for Committee", [1, 1], 9, 214],
];
const ORDER = ["Onboarding Draft", "Awaiting Onboarding Review", "Checklist in Progress", "Awaiting Signatory Approval", "Ready for Final Submission", "Awaiting Final Admin Review", "Authorized for Committee"];
const reached = (status) => (status === "Onboarding Denied" ? 1 : ORDER.indexOf(status));
const slotOf = (s) => (s[4] ? slotName(MEETINGS[s[4][0]][0], s[4][1]) : "");
const confirmed = new Set(SUBS.filter((s) => reached(s[3]) >= 2 && s[4] && MEETINGS[s[4][0]][1] === "Open").map(slotOf));

const slotRows = [];
for (const [t, status] of MEETINGS) {
  for (let n = 1; n <= 10; n++) {
    const start = t + (n - 1) * 6 * 60000;
    const name = slotName(t, n);
    slotRows.push([name, meetingName(t), name, iso(start), iso(start + 6 * 60000), 1, status === "Canceled" ? "Canceled" : "Open", confirmed.has(name) ? 1 : 0]);
  }
}
write("03", "slot", ["name", "meeting", "slotreference", "startat", "endat", "capacity", "status", "activeallocationcount"], slotRows);

// ---- checklist ------------------------------------------------------------------
const TEMPLATE = "NBPRA checklist (sample)";
write("04", "template", ["name", "code", "version", "status", "publishedat", "effectivefrom", "description"],
  [[TEMPLATE, "NBPRA-CHK", 1, "Published", iso(NOW - 200 * DAY), iso(NOW - 200 * DAY), "Placeholder checklist. Replace with the approved question catalogue."]],
);
const SECTIONS = [
  ["BUS", "Business and product overview"],
  ["SCO", "Scope and jurisdictions"],
  ["LEG", "Legal"],
  ["TAX", "Tax"],
  ["FIN", "Financial and commercial"],
  ["RSK", "Risk and compliance"],
  ["OPS", "Operating model"],
  ["TEC", "Technology and information security"],
  ["PRV", "Privacy and data"],
];
write("05", "sectiondef", ["name", "template", "code", "displayorder", "requiresapproval"], SECTIONS.map(([code, name], i) => [name, TEMPLATE, code, (i + 1) * 10, "Yes"]));

// code -> [label, type, required, options or accepted file extensions]
const QUESTIONS = {
  BUS: [["Describe the proposed business, product or service.", "Long text", true], ["Which client segment is it aimed at?", "Choice", true, ["Retail", "Corporate", "Institutional"]], ["When is the target launch date?", "Date", true], ["Is this an extension of an existing product?", "Boolean", true]],
  SCO: [["Which jurisdictions are in scope?", "Long text", true], ["How many legal entities are involved?", "Number", true], ["Does it involve cross-border distribution?", "Boolean", true]],
  LEG: [["Summarise the legal structure and key contracts.", "Long text", true], ["Are any new licences or permissions required?", "Boolean", true], ["List any unresolved legal points.", "Long text", false]],
  TAX: [["Describe the tax treatment of the product or transaction.", "Long text", true], ["Are there withholding or reporting implications?", "Boolean", true], ["Upload the tax assessment workbook (Excel).", "File", true, "xlsx,xls"]],
  FIN: [["Projected first-year revenue (USD)", "Number", true], ["Projected first-year cost (USD)", "Number", true], ["State the key financial assumptions.", "Long text", true], ["Upload the financial model (Excel).", "File", true, "xlsx,xls"]],
  RSK: [["Describe the principal risks and their controls.", "Long text", true], ["What is the residual risk rating?", "Choice", true, ["Low", "Medium", "High"]], ["Does the proposal change any policy or regulatory obligation?", "Boolean", true]],
  OPS: [["Describe the operating model and handoffs.", "Long text", true], ["Are third parties involved?", "Boolean", true]],
  TEC: [["Which systems are affected, and what changes?", "Long text", true], ["Does it introduce new external connectivity?", "Boolean", true]],
  PRV: [["Does the proposal involve personal data?", "Boolean", true], ["Describe the personal data and why it is needed.", "Long text", false]],
};
const questionRows = [];
const optionRows = [];
for (const [code, name] of SECTIONS) {
  QUESTIONS[code].forEach(([label, type, required, extra], i) => {
    const q = `${code}-${String(i + 1).padStart(2, "0")}`;
    questionRows.push([q, name, q, label, type, (i + 1) * 10, required ? "Yes" : "No", type === "File" ? "Yes" : "No", type === "File" ? extra : ""]);
    if (type === "Choice") extra.forEach((o, j) => optionRows.push([`${q} ${o}`, q, o.toUpperCase(), o, (j + 1) * 10, "Yes"]));
  });
}
write("06", "questiondef", ["name", "sectiondef", "code", "label", "answertype", "displayorder", "isrequired", "requiresevidence", "validationrule"], questionRows);
write("07", "questionoption", ["name", "questiondef", "valuecode", "label", "displayorder", "isactive"], optionRows);

// ---- submissions ----------------------------------------------------------------
const subRows = [];
const requestRows = [];
const sectionRows = [];
const seatRows = [];
const approvalRows = [];
const eventRows = [];
SUBS.forEach((s, i) => {
  const [title, area, type, status, , approved, age] = s;
  const r = reached(status);
  const born = NOW - age * DAY;
  const at = (f) => iso(born + f * age * DAY);
  const slot = slotOf(s);
  const unlocked = r >= 2;
  subRows.push([title, title, area, type, `Sample proposal: ${title}.`, "United States", status, r >= 3 ? 1 : 0, unlocked ? TEMPLATE : "", unlocked ? slot : "", at(0.97), r >= 5 ? at(0.88) : "", status === "Authorized for Committee" ? at(0.96) : ""]);

  let n = 0;
  const event = (f, type2, action, o = {}) => eventRows.push([action, title, type2, action, at(f), o.system ? "System" : "Human", o.channel ?? (o.system ? "System" : "App"), o.from ?? "", o.to ?? "", o.rev ?? "", o.reason ?? "", `sample:${i}:${++n}`]);
  event(0, "Submission", "Draft created", { to: "Onboarding Draft" });
  for (let seat = 1; seat <= 5; seat++) seatRows.push([`${title} · signatory ${seat}`, title, seat, 1, "Yes", at(0.02)]);

  if (r >= 1 && slot) {
    const st = status === "Onboarding Denied" ? "Denied" : status === "Awaiting Onboarding Review" ? "Pending" : "Approved";
    const reqName = `${title} · onboarding rev 1`;
    requestRows.push([reqName, title, 1, st, slot, st === "Approved" ? slot : "", at(0.05), st === "Approved" ? "Yes" : "No"]);
    approvalRows.push([`Onboarding: ${title}`, title, "Onboarding", "One authorized", st === "Approved" ? "Approved" : st, "", reqName, `sample:${i}:onboarding`, st === "Pending" ? "" : at(0.1)]);
    event(0.05, "Slot", "Onboarding submitted with five signatories", { from: "Onboarding Draft", to: "Awaiting Onboarding Review", rev: "Onboarding rev 1" });
    if (st === "Denied") event(0.3, "Slot", "Onboarding denied", { from: "Awaiting Onboarding Review", to: "Onboarding Denied", rev: "Onboarding rev 1", channel: "Email", reason: "Requested meeting is outside the committee remit." });
    if (st === "Approved") {
      event(0.1, "Slot", "Onboarding approved; slot confirmed", { from: "Awaiting Onboarding Review", to: "Checklist in Progress", rev: "Onboarding rev 1", channel: "Teams" });
      event(0.11, "Checklist", "Checklist unlocked", { system: true });
    }
  }
  if (unlocked) SECTIONS.forEach(([, name], k) => sectionRows.push([`${title} · ${name}`, title, name, k < approved ? "Approved" : k === approved ? "Draft" : "Not Started", "Yes"]));
  if (r >= 3) event(0.62, "Signatory", "Package sent to five signatories", { from: "Checklist in Progress", to: "Awaiting Signatory Approval", rev: "Package rev 1" });
  if (r >= 4) event(0.82, "Signatory", "All five signatories approved", { system: true, from: "Awaiting Signatory Approval", to: "Ready for Final Submission", rev: "Package rev 1" });
  if (r >= 5) {
    event(0.88, "Final submission", "Final submission made", { from: "Ready for Final Submission", to: "Awaiting Final Admin Review", rev: "Package rev 1" });
    approvalRows.push([`Committee admission: ${title}`, title, "Final Committee Admission", "One authorized", status === "Authorized for Committee" ? "Approved" : "Pending", 1, "", `sample:${i}:final`, status === "Authorized for Committee" ? at(0.96) : ""]);
  }
  if (status === "Authorized for Committee") event(0.96, "Admission", "Committee attendance authorized", { from: "Awaiting Final Admin Review", to: "Authorized for Committee", rev: "Package rev 1", channel: "Teams" });
  if (s[4] && MEETINGS[s[4][0]][1] === "Canceled") event(0.97, "Slot", "Meeting canceled; slot needs reassignment", { reason: "Committee quorum not available." });
});
write("08", "submission", ["name", "title", "businessarea", "proposaltype", "summary", "scope", "status", "packagerevision", "checklisttemplate", "assignedslot", "lastbusinessactivityat", "finalsubmittedat", "committeeauthorizedat"], subRows);
write("09", "slotrequest", ["name", "submission", "revisionnumber", "status", "requestedslot", "assignedslot", "submittedat", "allocationactive"], requestRows);
write("10", "sectioninstance", ["name", "submission", "sectiondef", "status", "isapplicable"], sectionRows);
write("11", "signatory", ["name", "submission", "slotnumber", "assignmentversion", "iscurrent", "assignedat"], seatRows);
write("12", "approvalrequest", ["name", "submission", "purpose", "policy", "status", "packagerevision", "slotrequest", "idempotencykey", "closedat"], approvalRows);
write("13", "businessevent", ["name", "submission", "eventtype", "action", "occurredat", "actorkind", "channel", "oldstatus", "newstatus", "summary", "reason", "eventkey"], eventRows);
