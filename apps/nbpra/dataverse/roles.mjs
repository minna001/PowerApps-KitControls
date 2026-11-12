#!/usr/bin/env node
// Creates the two NBPRA security roles in the solution. Safe to re-run.
//
//   NBPRA User           read on every NBPRA table. Writes go through the custom
//                        APIs, which run as SYSTEM and enforce the rules.
//   NBPRA Administrator  the same, plus create and edit on the calendar and
//                        checklist configuration. The custom APIs treat holders
//                        of this role as the administrator.
//
// Users also need the environment's standard Basic User role to open apps.
//
//   node roles.mjs --url https://<org>.crm.dynamics.com
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
const { api } = connect(urlArg, schema.solution);
const P = schema.publisherPrefix;
const CONFIG = ["committee", "meeting", "slot", "template", "sectiondef", "questiondef", "questionoption", "reviewroute"];

const privileges = (await api("GET", `privileges?$select=name,privilegeid&$filter=contains(name,'${P}_')`)).value;
const find = (verb, table) => {
  const p = privileges.find((x) => x.name.toLowerCase() === `prv${verb}${P}_${table}`.toLowerCase());
  if (!p) throw new Error(`Privilege prv${verb}${P}_${table} not found.`);
  return { PrivilegeId: p.privilegeid, Depth: "Global" };
};
const read = schema.tables.map((t) => find("Read", t.name));
const manage = CONFIG.flatMap((t) => ["Create", "Write", "Append", "AppendTo"].map((v) => find(v, t)));

const bu = (await api("GET", "businessunits?$select=businessunitid&$filter=_parentbusinessunitid_value eq null")).value[0].businessunitid;
for (const [name, description, set] of [
  ["NBPRA User", "Read access to NBPRA records for submitters, reviewers and signatories.", read],
  ["NBPRA Administrator", "NBPRA administrator: decides onboarding and committee admission, and maintains the calendar and checklist.", [...read, ...manage]],
]) {
  let id = (await api("GET", `roles?$select=roleid&$filter=name eq '${name}' and _businessunitid_value eq ${bu}`)).value[0]?.roleid;
  if (!id) id = (await api("POST", "roles", { name, description, "businessunitid@odata.bind": `/businessunits(${bu})` })).roleid;
  await api("POST", `roles(${id})/Microsoft.Dynamics.CRM.AddPrivilegesRole`, { Privileges: set }, { inSolution: false });
  console.log(`${name}: ${set.length} privileges`);
}
console.log("Done.");
