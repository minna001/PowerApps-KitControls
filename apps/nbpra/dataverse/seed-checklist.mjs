#!/usr/bin/env node
// Adds sample checklist questions, one review group and a review route for
// every section of the sample template (NBPRA-CHK v1). Placeholder content
// only: replace it with the approved question catalogue and real groups.
// Safe to re-run; sections that already have questions or a route are skipped.
//
//   node seed-checklist.mjs --url https://<org>.crm.dynamics.com
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
const { api, url } = connect(urlArg);
const BASE = 774100000;
const ch = (list, label) => BASE + schema.choices[list].indexOf(label);

// code -> [[label, type, required, options?]]
const QUESTIONS = {
  BUS: [
    ["Describe the proposed business, product or service.", "Long text", true],
    ["Which client segment is it aimed at?", "Choice", true, ["Retail", "Corporate", "Institutional"]],
    ["When is the target launch date?", "Date", true],
    ["Is this an extension of an existing product?", "Boolean", true],
  ],
  SCO: [
    ["Which jurisdictions are in scope?", "Long text", true],
    ["How many legal entities are involved?", "Number", true],
    ["Does it involve cross-border distribution?", "Boolean", true],
  ],
  LEG: [
    ["Summarise the legal structure and key contracts.", "Long text", true],
    ["Are any new licences or permissions required?", "Boolean", true],
    ["List any unresolved legal points.", "Long text", false],
  ],
  TAX: [
    ["Describe the tax treatment of the product or transaction.", "Long text", true],
    ["Are there withholding or reporting implications?", "Boolean", true],
  ],
  FIN: [
    ["Projected first-year revenue (USD)", "Number", true],
    ["Projected first-year cost (USD)", "Number", true],
    ["State the key financial assumptions.", "Long text", true],
  ],
  RSK: [
    ["Describe the principal risks and their controls.", "Long text", true],
    ["What is the residual risk rating?", "Choice", true, ["Low", "Medium", "High"]],
    ["Does the proposal change any policy or regulatory obligation?", "Boolean", true],
  ],
  OPS: [
    ["Describe the operating model and handoffs.", "Long text", true],
    ["Are third parties involved?", "Boolean", true],
  ],
  TEC: [
    ["Which systems are affected, and what changes?", "Long text", true],
    ["Does it introduce new external connectivity?", "Boolean", true],
  ],
  PRV: [
    ["Does the proposal involve personal data?", "Boolean", true],
    ["Describe the personal data and why it is needed.", "Long text", false],
  ],
};

const template = (await api("GET", "nbpra_templates?$select=nbpra_name&$filter=nbpra_code eq 'NBPRA-CHK' and nbpra_version eq 1")).value[0];
if (!template) {
  console.error("Sample template NBPRA-CHK v1 not found; run seed.mjs first.");
  process.exit(1);
}
const sections = (await api("GET", `nbpra_sectiondefs?$select=nbpra_code,nbpra_name&$filter=_nbpra_template_value eq ${template.nbpra_templateid}`)).value;

console.log("Review group");
const TEAM = "NBPRA Sample Reviewers";
const me = (await api("GET", "WhoAmI")).UserId;
let team = (await api("GET", `teams?$select=teamid&$filter=name eq '${TEAM}'`)).value[0]?.teamid;
if (!team) {
  const bu = (await api("GET", "businessunits?$select=businessunitid&$filter=_parentbusinessunitid_value eq null")).value[0].businessunitid;
  team = (await api("POST", "teams", { name: TEAM, teamtype: 0, description: "Sample functional review group for NBPRA.", "businessunitid@odata.bind": `/businessunits(${bu})`, "administratorid@odata.bind": `/systemusers(${me})` })).teamid;
}
const members = (await api("GET", `teams(${team})/teammembership_association?$select=systemuserid`)).value;
if (!members.some((m) => m.systemuserid === me)) {
  await api("POST", `teams(${team})/teammembership_association/$ref`, { "@odata.id": `${url}/api/data/v9.2/systemusers(${me})` });
}

let questions = 0;
let routes = 0;
for (const s of sections) {
  const sid = s.nbpra_sectiondefid;
  const have = (await api("GET", `nbpra_questiondefs?$select=nbpra_code&$filter=_nbpra_sectiondef_value eq ${sid}&$top=1`)).value.length;
  if (!have) {
    for (const [i, [label, type, required, options]] of (QUESTIONS[s.nbpra_code] ?? []).entries()) {
      const code = `${s.nbpra_code}-${String(i + 1).padStart(2, "0")}`;
      const q = await api("POST", "nbpra_questiondefs", {
        nbpra_name: code,
        nbpra_code: code,
        nbpra_label: label,
        nbpra_answertype: ch("answertype", type),
        nbpra_displayorder: (i + 1) * 10,
        nbpra_isrequired: required,
        nbpra_requiresevidence: false,
        "nbpra_sectiondef@odata.bind": `/nbpra_sectiondefs(${sid})`,
      });
      questions++;
      for (const [j, o] of (options ?? []).entries()) {
        await api("POST", "nbpra_questionoptions", {
          nbpra_name: o,
          nbpra_valuecode: o.toUpperCase(),
          nbpra_label: o,
          nbpra_displayorder: (j + 1) * 10,
          nbpra_isactive: true,
          "nbpra_questiondef@odata.bind": `/nbpra_questiondefs(${q.nbpra_questiondefid})`,
        });
      }
    }
  }
  const route = (await api("GET", `nbpra_reviewroutes?$select=nbpra_routecode&$filter=_nbpra_sectiondef_value eq ${sid}&$top=1`)).value.length;
  if (!route) {
    await api("POST", "nbpra_reviewroutes", {
      nbpra_name: `${s.nbpra_name} → ${TEAM}`,
      nbpra_routecode: "DEFAULT",
      nbpra_completionpolicy: ch("completionpolicy", "First authorized response"),
      nbpra_displayorder: 10,
      nbpra_isactive: true,
      "nbpra_sectiondef@odata.bind": `/nbpra_sectiondefs(${sid})`,
      "nbpra_reviewteam@odata.bind": `/teams(${team})`,
    });
    routes++;
  }
}
// Evidence questions: a required file per section, limited to the listed formats.
// Added on their own so environments seeded before these existed pick them up.
const EVIDENCE = {
  TAX: ["Upload the tax assessment workbook (Excel).", "xlsx,xls"],
  FIN: ["Upload the financial model (Excel).", "xlsx,xls"],
};
let evidence = 0;
for (const s of sections) {
  const spec = EVIDENCE[s.nbpra_code];
  if (!spec) continue;
  const code = `${s.nbpra_code}-EV1`;
  const have = (await api("GET", `nbpra_questiondefs?$select=nbpra_code&$filter=_nbpra_sectiondef_value eq ${s.nbpra_sectiondefid} and nbpra_code eq '${code}'`)).value.length;
  if (have) continue;
  await api("POST", "nbpra_questiondefs", {
    nbpra_name: code,
    nbpra_code: code,
    nbpra_label: spec[0],
    nbpra_answertype: ch("answertype", "File"),
    nbpra_displayorder: 900,
    nbpra_isrequired: true,
    nbpra_requiresevidence: true,
    nbpra_validationrule: spec[1],
    "nbpra_sectiondef@odata.bind": `/nbpra_sectiondefs(${s.nbpra_sectiondefid})`,
  });
  evidence++;
}
console.log(`Added ${evidence} evidence questions.`);
console.log(`Added ${questions} questions and ${routes} review routes across ${sections.length} sections. You are a member of "${TEAM}".`);
