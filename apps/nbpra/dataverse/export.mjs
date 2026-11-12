#!/usr/bin/env node
// Exports the NBPRA solution as a zip for import into another environment.
// Before exporting it takes the test-switch VALUES out of the solution, so the
// switches arrive off (their definitions default to false), sets the version,
// and publishes. The source environment keeps its own values.
//
//   node export.mjs --url https://<org>.crm.dynamics.com --out <file.zip> [--version 1.0.0.0] [--managed]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "./dv.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "schema.json"), "utf8"));
const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const urlArg = arg("--url");
const out = arg("--out");
if (!urlArg || !out) {
  console.error("Pass --url https://<org>.crm.dynamics.com --out <file.zip>");
  process.exit(1);
}
const { api } = connect(urlArg);
const NAME = schema.solution;
const version = arg("--version") ?? "1.0.0.0";
const managed = args.includes("--managed");

const sol = (await api("GET", `solutions?$select=solutionid,version&$filter=uniquename eq '${NAME}'`)).value[0];
if (!sol) throw new Error(`Solution ${NAME} not found.`);

// Test-switch values that sit inside the solution would travel with it. They
// are deleted for the export and recreated afterwards outside the solution, so
// this environment keeps its settings and the export carries only the
// definitions, which default to off.
console.log("Test switches");
const restore = [];
for (const s of ["nbpra_AllowSelfApproval", "nbpra_AllowDuplicateSignatories"]) {
  const def = (await api("GET", `environmentvariabledefinitions?$select=environmentvariabledefinitionid&$filter=schemaname eq '${s}'`)).value[0];
  if (!def) continue;
  for (const v of (await api("GET", `environmentvariablevalues?$select=environmentvariablevalueid,value&$filter=_environmentvariabledefinitionid_value eq ${def.environmentvariabledefinitionid}`)).value) {
    const inSolution = (await api("GET", `solutioncomponents?$select=solutioncomponentid&$filter=_solutionid_value eq ${sol.solutionid} and objectid eq ${v.environmentvariablevalueid}`)).value.length > 0;
    if (inSolution) {
      await api("DELETE", `environmentvariablevalues(${v.environmentvariablevalueid})`);
      restore.push({ name: s, definition: def.environmentvariabledefinitionid, value: v.value });
    }
    console.log(`  ${s}: value "${v.value}" ${inSolution ? "taken out of the solution for the export" : "is not in the solution"}`);
  }
}
async function putBack() {
  for (const r of restore.splice(0)) {
    await api("POST", "environmentvariablevalues", { value: r.value, "EnvironmentVariableDefinitionId@odata.bind": `/environmentvariabledefinitions(${r.definition})` });
    console.log(`  ${r.name}: value "${r.value}" restored in this environment`);
  }
}

try {
console.log(`Version ${sol.version} -> ${version}; publishing`);
await api("PATCH", `solutions(${sol.solutionid})`, { version });
await api("POST", "PublishAllXml", {});

console.log("Contents");
const TYPES = { 1: "tables", 9: "choices", 20: "security roles", 26: "views", 60: "forms", 61: "web resources", 62: "site maps", 80: "model-driven apps", 91: "plug-in assemblies", 300: "canvas or code apps", 380: "environment variable definitions", 381: "environment variable values" };
const comps = (await api("GET", `solutioncomponents?$select=componenttype&$filter=_solutionid_value eq ${sol.solutionid}`)).value;
const counts = {};
for (const c of comps) counts[TYPES[c.componenttype] ?? `type ${c.componenttype}`] = (counts[TYPES[c.componenttype] ?? `type ${c.componenttype}`] ?? 0) + 1;
for (const [k, v] of Object.entries(counts).sort()) console.log(`  ${v} ${k}`);

console.log(`Exporting (${managed ? "managed" : "unmanaged"})`);
const r = await api("POST", "ExportSolution", { SolutionName: NAME, Managed: managed });
const bytes = Buffer.from(r.ExportSolutionFile, "base64");
writeFileSync(out, bytes);
console.log(`Wrote ${out} (${Math.round(bytes.length / 1024)} KB)`);
} finally {
  await putBack();
}
