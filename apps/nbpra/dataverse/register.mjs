#!/usr/bin/env node
// Registers the plug-in assembly and its custom APIs (nbpra_AdminDecision, nbpra_Workflow)
// and the two test switches. Add --single-user-test in a one-user development environment.
// Build the plug-in first: (cd ../plugin && dotnet build -c Release).
// Safe to re-run; the assembly content is replaced in place.
//
//   node register.mjs --url https://<org>.crm.dynamics.com
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
const ASSEMBLY = "Nbpra.Plugins";
const content = readFileSync(join(here, "../plugin/bin/Release/net48/Nbpra.Plugins.dll")).toString("base64");

console.log("Assembly");
let asm = (await api("GET", `pluginassemblies?$select=pluginassemblyid&$filter=name eq '${ASSEMBLY}'`)).value[0]?.pluginassemblyid;
if (asm) await api("PATCH", `pluginassemblies(${asm})`, { content });
else asm = (await api("POST", "pluginassemblies", { name: ASSEMBLY, content, isolationmode: 2, sourcetype: 0, description: "NBPRA server-side business operations." })).pluginassemblyid;

const STRING = 10;
const param = (n, d, optional = false) => ({ uniquename: n, name: n, displayname: n, description: d, type: STRING, isoptional: optional });
const prop = (n, d) => ({ uniquename: n, name: n, displayname: n, description: d, type: STRING });

const APIS = [
  {
    type: "Nbpra.Plugins.AdminDecision",
    api: "nbpra_AdminDecision",
    name: "NBPRA admin decision",
    description: "Records Kate's onboarding or committee-admission decision for a submission.",
    params: [
      param("SubmissionId", "Submission record id."),
      param("Action", "approveOnboarding, denyOnboarding, authorize, returnFinal or rejectFinal."),
      param("Comment", "Reason; required to deny, return or reject.", true),
      param("Channel", "App, Teams or Email. Defaults to App.", true),
    ],
    props: [prop("Outcome", "accepted, already_resolved, unauthorized or validation_failed."), prop("Message", "Readable result."), prop("NewStatus", "Submission status after the call.")],
  },
  {
    type: "Nbpra.Plugins.Workflow",
    api: "nbpra_Workflow",
    name: "NBPRA workflow",
    description: "Submitter, functional reviewer and signatory steps: onboarding, checklist sections, reviews, signatory approvals and final submission.",
    params: [
      param("Operation", "context, saveOnboarding, submitOnboarding, saveSection, submitSection, decideReview, requestSignatories, decideSignatory or finalSubmit."),
      param("TargetId", "Id of the record the operation acts on.", true),
      param("Outcome", "approve, changes or return, for decisions.", true),
      param("Comment", "Reason; required to request changes or return.", true),
      param("Payload", "JSON for saveOnboarding and saveSection.", true),
    ],
    props: [prop("Outcome", "accepted, already_resolved, unauthorized or validation_failed."), prop("Message", "Readable result."), prop("Data", "Operation result, where there is one.")],
  },
];

for (const a of APIS) {
  console.log(`Custom API ${a.api}`);
  let type = (await api("GET", `plugintypes?$select=plugintypeid&$filter=typename eq '${a.type}'`)).value[0]?.plugintypeid;
  if (!type) type = (await api("POST", "plugintypes", { typename: a.type, name: a.type, friendlyname: a.name, "pluginassemblyid@odata.bind": `/pluginassemblies(${asm})` })).plugintypeid;
  const found = (await api("GET", `customapis?$select=customapiid&$filter=uniquename eq '${a.api}'`)).value[0];
  if (found) continue;
  await api("POST", "customapis", {
    uniquename: a.api,
    name: a.name,
    displayname: a.name,
    description: a.description,
    bindingtype: 0,
    isfunction: false,
    isprivate: false,
    allowedcustomprocessingsteptype: 0,
    "PluginTypeId@odata.bind": `/plugintypes(${type})`,
    CustomAPIRequestParameters: a.params,
    CustomAPIResponseProperties: a.props,
  });
}

// Test switches. Both are off unless a value is set; --single-user-test turns them on
// for a development environment that has only one user.
const SWITCHES = [
  ["nbpra_AllowSelfApproval", "NBPRA allow self-approval (testing only)", "Set to true only in a test environment to let a person decide or review their own submission."],
  ["nbpra_AllowDuplicateSignatories", "NBPRA allow repeated signatories (testing only)", "Set to true only in a test environment with fewer than five users, so one person can fill several signatory seats."],
];
const turnOn = args.includes("--single-user-test") || args.includes("--allow-self-approval");
for (const [schemaname, displayname, description] of SWITCHES) {
  let def = (await api("GET", `environmentvariabledefinitions?$select=environmentvariabledefinitionid&$filter=schemaname eq '${schemaname}'`)).value[0];
  if (!def) def = await api("POST", "environmentvariabledefinitions", { schemaname, displayname, description, type: 100000000, defaultvalue: "false" });
  if (!turnOn) continue;
  const id = def.environmentvariabledefinitionid;
  const v = (await api("GET", `environmentvariablevalues?$select=environmentvariablevalueid&$filter=_environmentvariabledefinitionid_value eq ${id}`)).value[0];
  if (v) await api("PATCH", `environmentvariablevalues(${v.environmentvariablevalueid})`, { value: "true" });
  else await api("POST", "environmentvariablevalues", { value: "true", "EnvironmentVariableDefinitionId@odata.bind": `/environmentvariabledefinitions(${id})` });
  console.log(`Test switch ON: ${schemaname}`);
}
console.log("Done.");
