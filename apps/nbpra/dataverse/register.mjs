#!/usr/bin/env node
// Registers the plug-in assembly and the nbpra_AdminDecision custom API.
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

console.log("Plug-in type");
const TYPE = "Nbpra.Plugins.AdminDecision";
let type = (await api("GET", `plugintypes?$select=plugintypeid&$filter=typename eq '${TYPE}'`)).value[0]?.plugintypeid;
if (!type) type = (await api("POST", "plugintypes", { typename: TYPE, name: TYPE, friendlyname: "NBPRA admin decision", "pluginassemblyid@odata.bind": `/pluginassemblies(${asm})` })).plugintypeid;

console.log("Custom API");
const API = "nbpra_AdminDecision";
const STRING = 10;
const param = (n, d, optional = false) => ({ uniquename: n, name: n, displayname: n, description: d, type: STRING, isoptional: optional });
const prop = (n, d) => ({ uniquename: n, name: n, displayname: n, description: d, type: STRING });
const found = (await api("GET", `customapis?$select=customapiid&$filter=uniquename eq '${API}'`)).value[0];
if (!found) {
  await api("POST", "customapis", {
    uniquename: API,
    name: "NBPRA admin decision",
    displayname: "NBPRA admin decision",
    description: "Records Kate's onboarding or committee-admission decision for a submission.",
    bindingtype: 0,
    isfunction: false,
    isprivate: false,
    allowedcustomprocessingsteptype: 0,
    "PluginTypeId@odata.bind": `/plugintypes(${type})`,
    CustomAPIRequestParameters: [
      param("SubmissionId", "Submission record id."),
      param("Action", "approveOnboarding, denyOnboarding, authorize, returnFinal or rejectFinal."),
      param("Comment", "Reason; required to deny, return or reject.", true),
      param("Channel", "App, Teams or Email. Defaults to App.", true),
    ],
    CustomAPIResponseProperties: [
      prop("Outcome", "accepted, already_resolved, unauthorized or validation_failed."),
      prop("Message", "Readable result."),
      prop("NewStatus", "Submission status after the call."),
    ],
  });
}

console.log("Test switch (off)");
const ENV = "nbpra_AllowSelfApproval";
const def = (await api("GET", `environmentvariabledefinitions?$select=schemaname&$filter=schemaname eq '${ENV}'`)).value[0];
if (!def) {
  await api("POST", "environmentvariabledefinitions", {
    schemaname: ENV,
    displayname: "NBPRA allow self-approval (testing only)",
    description: "Set to true only in a test environment to let an administrator decide their own submission.",
    type: 100000000,
    defaultvalue: "false",
  });
}
// --allow-self-approval turns the switch on, for a single-user test environment only.
if (args.includes("--allow-self-approval")) {
  const d = (await api("GET", `environmentvariabledefinitions?$select=environmentvariabledefinitionid&$filter=schemaname eq '${ENV}'`)).value[0];
  const v = (await api("GET", `environmentvariablevalues?$select=environmentvariablevalueid&$filter=_environmentvariabledefinitionid_value eq ${d.environmentvariabledefinitionid}`)).value[0];
  if (v) await api("PATCH", `environmentvariablevalues(${v.environmentvariablevalueid})`, { value: "true" });
  else await api("POST", "environmentvariablevalues", { value: "true", "EnvironmentVariableDefinitionId@odata.bind": `/environmentvariabledefinitions(${d.environmentvariabledefinitionid})` });
  console.log("Test switch ON: administrators may decide their own submissions in this environment.");
}
console.log("Done.");
