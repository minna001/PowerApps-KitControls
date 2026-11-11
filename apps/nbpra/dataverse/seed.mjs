#!/usr/bin/env node
// Loads sample data: one committee, four meetings with timed slots, a
// placeholder checklist template and ten submissions spread across the
// lifecycle. Everything is invented. Runs once; it stops if the sample
// committee already exists.
//
//   node seed.mjs --url https://<org>.crm.dynamics.com
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./dv.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "schema.json"), "utf8"));
const args = process.argv.slice(2);
const urlArg = args[args.indexOf("--url") + 1];
if (!args.includes("--url") || !urlArg) {
  console.error("Pass --url https://<org>.crm.dynamics.com");
  process.exit(1);
}
const { api } = connect(urlArg);
const P = schema.publisherPrefix;
const BASE = 774100000;
const ch = (list, label) => {
  const i = schema.choices[list].indexOf(label);
  if (i < 0) throw new Error(`No option "${label}" in ${list}`);
  return BASE + i;
};

// entity set names, e.g. submission -> nbpra_submissions
const SET = {};
for (const t of schema.tables) {
  SET[t.name] = (await api("GET", `EntityDefinitions(LogicalName='${P}_${t.name}')?$select=EntitySetName`)).EntitySetName;
}
const ref = (table, id) => (table === "systemuser" ? `/systemusers(${id})` : table === "team" ? `/teams(${id})` : `/${SET[table]}(${id})`);

/** Creates a row. Plain keys get the publisher prefix; { table: id } pairs in `links` become lookups. */
async function create(table, fields, links = {}, extra = {}) {
  const body = { ...extra };
  for (const [k, v] of Object.entries(fields)) body[`${P}_${k}`] = v;
  for (const [k, [target, id]] of Object.entries(links)) if (id) body[`${P}_${k}@odata.bind`] = ref(target, id);
  const row = await api("POST", SET[table], body);
  return row[`${P}_${table}id`];
}
const update = (table, id, fields, links = {}) => {
  const body = {};
  for (const [k, v] of Object.entries(fields)) body[`${P}_${k}`] = v;
  for (const [k, [target, tid]] of Object.entries(links)) body[`${P}_${k}@odata.bind`] = ref(target, tid);
  return api("PATCH", `${SET[table]}(${id})`, body);
};

const existing = await api("GET", `${SET.committee}?$select=${P}_code&$filter=${P}_code eq 'NBPRC'`);
if (existing.value.length) {
  console.log("Sample committee NBPRC already exists; nothing loaded.");
  process.exit(0);
}

// ---- people -----------------------------------------------------------------
const me = (await api("GET", "WhoAmI")).UserId;
const users = (await api("GET", "systemusers?$select=fullname&$filter=isdisabled eq false and accessmode eq 0")).value;
const others = users.filter((u) => u.systemuserid !== me);
// With nobody else in the environment the signed-in user owns everything, and
// deciding those submissions needs the nbpra_AllowSelfApproval test switch.
if (others.length === 0) console.log("SINGLE_USER: you are the only user here, so you own every sample submission.");
const owner = (i) => (others.length ? others[i % others.length].systemuserid : me);
// Five signatory seats. With fewer than five users in the tenant, people repeat.
const pool = [me, ...others.map((u) => u.systemuserid)];
const seat = (i) => pool[i % pool.length];
console.log(`Users: ${users.length} (signatory seats ${pool.length >= 5 ? "all distinct" : "repeat people; the tenant has fewer than five users"})`);
const team = (await api("GET", "teams?$select=name&$filter=isdefault eq true&$top=1")).value[0].teamid;

const NOW = Date.now();
const DAY = 86400000;
const iso = (ms) => new Date(ms).toISOString();

// ---- calendar ---------------------------------------------------------------
console.log("Committee, meetings, slots");
const committee = await create(
  "committee",
  { name: "New Business and Product Risk Committee", code: "NBPRC", description: "Sample committee.", defaulttimezone: "Eastern Standard Time", isactive: true },
  { adminteam: ["team", team] },
);
const MEETINGS = [
  ["2026-11-25", "Canceled", "Committee quorum not available."],
  ["2026-12-02", "Open"],
  ["2026-12-16", "Open"],
  ["2027-01-13", "Open"],
];
const slots = {}; // "2026-12-02#3" -> slot id
for (const [date, status, reason] of MEETINGS) {
  const start = Date.parse(`${date}T15:00:00Z`);
  const meeting = await create(
    "meeting",
    {
      name: `NBPRC ${date}`,
      startat: iso(start),
      endat: iso(start + 3600000),
      timezone: "Eastern Standard Time",
      requestopenat: iso(start - 90 * DAY),
      requestcloseat: iso(start - 14 * DAY),
      submissiondeadlineat: iso(start - 5 * DAY),
      status: ch("meetingstatus", status),
      ...(reason ? { cancellationreason: reason } : {}),
    },
    { committee: ["committee", committee] },
  );
  for (let n = 1; n <= 10; n++) {
    const s = start + (n - 1) * 6 * 60000;
    const code = `NBPRC-${date.replace(/-/g, "")}-${String(n).padStart(2, "0")}`;
    slots[`${date}#${n}`] = await create(
      "slot",
      { name: code, slotreference: code, startat: iso(s), endat: iso(s + 6 * 60000), capacity: 1, status: ch("slotstatus", status === "Canceled" ? "Canceled" : "Open"), activeallocationcount: 0 },
      { meeting: ["meeting", meeting] },
    );
  }
}

// ---- checklist template (placeholder) ----------------------------------------
console.log("Checklist template");
const template = await create("template", {
  name: "NBPRA checklist (sample)",
  code: "NBPRA-CHK",
  version: 1,
  status: ch("templatestatus", "Published"),
  publishedat: iso(NOW - 200 * DAY),
  effectivefrom: iso(NOW - 200 * DAY),
  description: "Placeholder sections from requirements 11.2. Replace with the approved question catalogue.",
});
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
const sectionDefs = [];
for (const [i, [code, name]] of SECTIONS.entries()) {
  sectionDefs.push(await create("sectiondef", { name, code, displayorder: (i + 1) * 10, requiresapproval: true }, { template: ["template", template] }));
}

// ---- submissions --------------------------------------------------------------
// [title, area, type, status, age days, slot key, sections approved, signatories approved]
const SUBS = [
  ["Tokenised Deposit Pilot", "Global Markets", "New product", "Onboarding Draft", 6, null, 0, 0],
  ["Corporate Card Virtual Issuance", "Commercial Banking", "New product", "Awaiting Onboarding Review", 9, "2026-12-16#3", 0, 0],
  ["Carbon Credit Custody", "Global Markets", "New business", "Awaiting Onboarding Review", 3, "2026-12-16#3", 0, 0],
  ["Instant Payee Verification", "Payments", "Material change", "Onboarding Denied", 12, "2026-12-02#9", 0, 0],
  ["SME Overdraft Repricing", "Retail Banking", "Material change", "Checklist in Progress", 31, "2026-12-02#4", 2, 0],
  ["Crypto Custody Staking Extension", "Global Markets", "Product extension", "Awaiting Signatory Approval", 142, "2026-12-02#5", 9, 3],
  ["Green Mortgage Rate Discount", "Retail Banking", "New product", "Ready for Final Submission", 58, "2026-12-02#6", 9, 5],
  ["Supplier Finance Onboarding Portal", "Commercial Banking", "New business", "Awaiting Final Admin Review", 71, "2026-12-02#7", 9, 5],
  ["Private Credit Feeder Fund", "Wealth", "New product", "Awaiting Final Admin Review", 102, "2026-11-25#2", 9, 5],
  ["Real-Time FX Rate Lock", "Payments", "Product extension", "Authorized for Committee", 214, "2026-12-02#1", 9, 5],
];
const ORDER = ["Onboarding Draft", "Awaiting Onboarding Review", "Checklist in Progress", "Awaiting Signatory Approval", "Ready for Final Submission", "Awaiting Final Admin Review", "Authorized for Committee"];

console.log("Submissions");
for (const [i, [title, area, type, status, age, slotKey, secApproved, sigApproved]] of SUBS.entries()) {
  const born = NOW - age * DAY;
  const at = (frac) => iso(born + frac * age * DAY);
  const reached = status === "Onboarding Denied" ? 1 : ORDER.indexOf(status);
  const unlocked = reached >= 2;
  const slotId = slotKey ? slots[slotKey] : null;

  const sub = await create(
    "submission",
    {
      name: title,
      title,
      businessarea: area,
      proposaltype: type,
      summary: `Sample proposal: ${title}.`,
      scope: "United States",
      status: ch("submissionstatus", status),
      packagerevision: reached >= 3 ? 1 : 0,
      lastbusinessactivityat: at(0.97),
      ...(reached >= 5 ? { finalsubmittedat: at(0.88) } : {}),
      ...(status === "Authorized for Committee" ? { committeeauthorizedat: at(0.96) } : {}),
    },
    {
      businessowner: ["systemuser", owner(i)],
      sponsor: ["systemuser", owner(i + 1)],
      ...(unlocked ? { checklisttemplate: ["template", template], assignedslot: ["slot", slotId] } : {}),
      ...(status === "Authorized for Committee" ? { committeeauthorizedby: ["systemuser", me] } : {}),
    },
    { overriddencreatedon: iso(born) },
  );
  const S = ["submission", sub];

  const event = (frac, type, action, o = {}) =>
    create(
      "businessevent",
      {
        name: action,
        eventtype: ch("eventtype", type),
        action,
        occurredat: at(frac),
        actorkind: ch("actorkind", o.system ? "System" : "Human"),
        channel: ch("channel", o.channel ?? (o.system ? "System" : "App")),
        eventkey: `sample:${i}:${frac}:${action}`.slice(0, 190),
        ...(o.from ? { oldstatus: o.from } : {}),
        ...(o.to ? { newstatus: o.to } : {}),
        ...(o.rev ? { summary: o.rev } : {}),
        ...(o.reason ? { reason: o.reason } : {}),
      },
      { submission: S, ...(o.system ? {} : { actor: ["systemuser", o.actor ?? owner(i)] }) },
    );

  await event(0, "Submission", "Draft created", { to: "Onboarding Draft" });
  for (let n = 1; n <= 5; n++) {
    await create("signatory", { name: `Signatory ${n}`, slotnumber: n, assignmentversion: 1, iscurrent: true, assignedat: at(0.02) }, { submission: S, person: ["systemuser", seat(i + n)], assignedby: ["systemuser", owner(i)] });
  }

  if (reached >= 1 && slotId) {
    const srStatus = status === "Onboarding Denied" ? "Denied" : status === "Awaiting Onboarding Review" ? "Pending" : "Approved";
    const sr = await create(
      "slotrequest",
      { name: `${title} · onboarding rev 1`, revisionnumber: 1, status: ch("slotrequeststatus", srStatus), submittedat: at(0.05), allocationactive: srStatus === "Approved", intakesnapshot: JSON.stringify({ title, area, type }) },
      { submission: S, requestedslot: ["slot", slotId], submittedby: ["systemuser", owner(i)], ...(srStatus === "Approved" ? { assignedslot: ["slot", slotId] } : {}) },
    );
    await update("submission", sub, {}, { currentslotrequest: ["slotrequest", sr] });
    if (srStatus === "Approved" && !slotKey.startsWith("2026-11-25")) await update("slot", slotId, { activeallocationcount: 1 });
    await event(0.05, "Slot", "Onboarding submitted with five signatories", { from: "Onboarding Draft", to: "Awaiting Onboarding Review", rev: "Onboarding rev 1" });

    const req = await create(
      "approvalrequest",
      {
        name: `Onboarding: ${title}`,
        purpose: ch("approvalpurpose", "Onboarding"),
        policy: ch("approvalpolicy", "One authorized"),
        status: ch("approvalstatus", srStatus === "Pending" ? "Pending" : srStatus === "Denied" ? "Denied" : "Approved"),
        idempotencykey: `sample:${i}:onboarding`,
        ...(srStatus === "Pending" ? {} : { closedat: at(0.1) }),
      },
      { submission: S, slotrequest: ["slotrequest", sr] },
    );
    await update("slotrequest", sr, {}, { decisionrequest: ["approvalrequest", req] });
    if (srStatus === "Denied") await event(0.3, "Slot", "Onboarding denied", { actor: me, from: "Awaiting Onboarding Review", to: "Onboarding Denied", rev: "Onboarding rev 1", channel: "Email", reason: "Requested meeting is outside the committee remit." });
    if (srStatus === "Approved") {
      await event(0.1, "Slot", "Onboarding approved; slot confirmed", { actor: me, from: "Awaiting Onboarding Review", to: "Checklist in Progress", rev: "Onboarding rev 1", channel: "Teams" });
      await event(0.11, "Checklist", "Checklist unlocked", { system: true });
    }
  }

  if (unlocked) {
    for (const [n, def] of sectionDefs.entries()) {
      const st = n < secApproved ? "Approved" : n === secApproved ? "Draft" : "Not Started";
      await create(
        "sectioninstance",
        { name: SECTIONS[n][1], status: ch("sectionstatus", st), isapplicable: true, ...(st === "Approved" ? { lastsubmittedat: at(0.4), approvedat: at(0.55) } : {}) },
        { submission: S, sectiondef: ["sectiondef", def] },
      );
    }
  }
  if (reached >= 3) {
    await event(0.6, "Section", "All required functional approvals current", { system: true });
    await event(0.62, "Signatory", "Package sent to five signatories", { from: "Checklist in Progress", to: "Awaiting Signatory Approval", rev: "Package rev 1" });
    for (let n = 1; n <= sigApproved; n++) await event(0.64 + n * 0.03, "Signatory", `Signatory ${n} approved`, { actor: seat(i + n), rev: "Package rev 1", channel: n % 2 ? "App" : "Email" });
  }
  if (reached >= 4) await event(0.82, "Signatory", "All five signatories approved", { system: true, from: "Awaiting Signatory Approval", to: "Ready for Final Submission", rev: "Package rev 1" });
  if (reached >= 5) {
    await event(0.88, "Final submission", "Final submission made", { from: "Ready for Final Submission", to: "Awaiting Final Admin Review", rev: "Package rev 1" });
    await create(
      "approvalrequest",
      {
        name: `Committee admission: ${title}`,
        purpose: ch("approvalpurpose", "Final Committee Admission"),
        policy: ch("approvalpolicy", "One authorized"),
        status: ch("approvalstatus", status === "Authorized for Committee" ? "Approved" : "Pending"),
        packagerevision: 1,
        idempotencykey: `sample:${i}:final`,
        ...(status === "Authorized for Committee" ? { closedat: at(0.96) } : {}),
      },
      { submission: S },
    );
  }
  if (status === "Authorized for Committee") await event(0.96, "Admission", "Committee attendance authorized", { actor: me, from: "Awaiting Final Admin Review", to: "Authorized for Committee", rev: "Package rev 1", channel: "Teams" });
  if (slotKey?.startsWith("2026-11-25")) await event(0.97, "Slot", "Meeting canceled; slot needs reassignment", { actor: me, reason: "Committee quorum not available." });
  console.log(`  ${title} — ${status}`);
}

const count = async (t) => (await api("GET", `${SET[t]}?$select=${P}_${t}id&$count=true&$top=1`, undefined, { headers: { Prefer: 'odata.include-annotations="*"' } }))["@odata.count"];
console.log(`Loaded: ${await count("submission")} submissions, ${await count("slot")} slots, ${await count("signatory")} signatory seats, ${await count("sectioninstance")} section instances, ${await count("businessevent")} events, ${await count("approvalrequest")} approval requests.`);
