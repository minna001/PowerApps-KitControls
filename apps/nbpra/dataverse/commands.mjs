#!/usr/bin/env node
// Uploads the admin.js web resource and adds Kate's five decision buttons to
// the Submission form command bar in the NBPRA Admin app. Safe to re-run.
//
//   node commands.mjs --url https://<org>.crm.dynamics.com
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
const TABLE = `${P}_submission`;

console.log("Web resource");
const WR = `${P}_/admin.js`;
const content = readFileSync(join(here, "webresources/admin.js")).toString("base64");
let wr = (await api("GET", `webresourceset?$select=webresourceid&$filter=name eq '${WR}'`)).value[0]?.webresourceid;
if (wr) await api("PATCH", `webresourceset(${wr})`, { content });
else wr = (await api("POST", "webresourceset", { name: WR, displayname: "NBPRA admin commands", webresourcetype: 3, content })).webresourceid;

const app = (await api("GET", `appmodules/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()?$select=appmoduleid&$filter=uniquename eq '${P}_Admin'`)).value[0]?.appmoduleid;
if (!app) throw new Error("NBPRA Admin app not found; run mda.mjs first.");
const entityId = (await api("GET", `EntityDefinitions(LogicalName='${TABLE}')?$select=MetadataId`)).MetadataId;

// Lookup navigation names differ by table; read them from metadata.
const rels = (await api("GET", "EntityDefinitions(LogicalName='appaction')/ManyToOneRelationships?$select=ReferencingAttribute,ReferencingEntityNavigationPropertyName,ReferencedEntity")).value;
const nav = (attr) => {
  const r = rels.find((x) => x.ReferencingAttribute === attr);
  if (!r) throw new Error(`No relationship for appaction.${attr}`);
  return r.ReferencingEntityNavigationPropertyName;
};
const setOf = async (logical) => (await api("GET", `EntityDefinitions(LogicalName='${logical}')?$select=EntitySetName`)).EntitySetName;
const entitySet = await setOf(rels.find((x) => x.ReferencingAttribute === "contextentity").ReferencedEntity);

const BUTTONS = [
  ["approveOnboarding", "Approve onboarding", "Approve the onboarding request, confirm the slot and unlock the checklist."],
  ["denyOnboarding", "Deny onboarding", "Deny the onboarding request. A reason is required."],
  ["authorize", "Authorize for committee", "Authorize committee attendance for the final package."],
  ["returnFinal", "Return for changes", "Return the final package to the submitter. A reason is required."],
  ["rejectFinal", "Reject admission", "Reject committee admission. A reason is required."],
];

console.log("Buttons");
for (const [i, [fn, label, tip]] of BUTTONS.entries()) {
  const uniquename = `${P}_submission_${fn}`;
  const body = {
    name: label,
    uniquename,
    buttonlabeltext: label,
    buttonaccessibilitytext: label,
    buttontooltiptitle: label,
    buttontooltipdescription: tip,
    type: 0,
    location: 0,
    context: 1,
    contextvalue: TABLE,
    onclickeventtype: 2,
    onclickeventjavascriptfunctionname: `NBPRA.${fn}`,
    onclickeventjavascriptparameters: JSON.stringify([{ type: 5, value: null }]),
    visibilitytype: 0,
    hidden: false,
    isdisabled: false,
    sequence: 100 + i * 10,
    [`${nav("appmoduleid")}@odata.bind`]: `/appmodules(${app})`,
    [`${nav("contextentity")}@odata.bind`]: `/${entitySet}(${entityId})`,
    [`${nav("onclickeventjavascriptwebresourceid")}@odata.bind`]: `/webresourceset(${wr})`,
  };
  const found = (await api("GET", `appactions?$select=appactionid&$filter=uniquename eq '${uniquename}'`)).value[0];
  if (found) await api("PATCH", `appactions(${found.appactionid})`, body);
  else await api("POST", "appactions", body);
}

console.log("Publishing");
await api("POST", "PublishAllXml", {}, { inSolution: false });
const check = (await api("GET", `appactions?$select=buttonlabeltext,location,statecode&$filter=startswith(uniquename,'${P}_submission_')`)).value;
console.log(`Done. ${check.length} buttons: ${check.map((b) => b.buttonlabeltext).join(", ")}`);
