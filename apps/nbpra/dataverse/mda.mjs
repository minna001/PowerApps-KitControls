#!/usr/bin/env node
// Builds the NBPRA model-driven app: public views, site map and the app module.
// Safe to re-run; views and the site map are updated in place.
//
//   node mda.mjs --url https://<org>.crm.dynamics.com
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
const OPTION_BASE = 774100000; // must match provision.mjs
const choice = (list, label) => {
  const i = schema.choices[list].indexOf(label);
  if (i < 0) throw new Error(`No option "${label}" in ${list}`);
  return OPTION_BASE + i;
};
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

// ---- views ------------------------------------------------------------------
// [table, view name, columns [name,width], filter xml, order [col, desc?]]
const SUB_COLS = [["reference", 140], ["name", 240], ["status", 190], ["businessowner", 150], ["businessarea", 140], ["assignedslot", 150], ["packagerevision", 80], ["lastbusinessactivityat", 150], ["createdon", 130]];
const st = (label) => `<condition attribute="${P}_status" operator="eq" value="${choice("submissionstatus", label)}" />`;
const VIEWS = [
  ["submission", "All submissions", SUB_COLS, "", ["createdon", true]],
  ["submission", "Awaiting onboarding review", SUB_COLS, st("Awaiting Onboarding Review"), ["createdon", false]],
  ["submission", "Awaiting final admin review", SUB_COLS, st("Awaiting Final Admin Review"), ["finalsubmittedat", false]],
  ["submission", "Checklist and approvals in progress", SUB_COLS, `<condition attribute="${P}_status" operator="in"><value>${choice("submissionstatus", "Checklist in Progress")}</value><value>${choice("submissionstatus", "Awaiting Signatory Approval")}</value><value>${choice("submissionstatus", "Ready for Final Submission")}</value></condition>`, ["lastbusinessactivityat", false]],
  ["submission", "Denied, returned or rejected", SUB_COLS, `<condition attribute="${P}_status" operator="in"><value>${choice("submissionstatus", "Onboarding Denied")}</value><value>${choice("submissionstatus", "Final Changes Requested")}</value><value>${choice("submissionstatus", "Final Rejected")}</value></condition>`, ["lastbusinessactivityat", true]],
  ["submission", "Authorized for committee", SUB_COLS, st("Authorized for Committee"), ["committeeauthorizedat", true]],
  ["submission", "Withdrawn", SUB_COLS, st("Withdrawn"), ["withdrawnat", true]],
  ["approvalrequest", "Pending approval requests", [["submission", 200], ["purpose", 190], ["reviewteam", 150], ["status", 130], ["createdon", 140], ["dueat", 140], ["integrationstate", 130]], `<condition attribute="${P}_status" operator="eq" value="${choice("approvalstatus", "Pending")}" />`, ["createdon", false]],
  ["approvalrequest", "All approval requests", [["submission", 200], ["purpose", 190], ["reviewteam", 150], ["status", 130], ["createdon", 140], ["closedat", 140]], "", ["createdon", true]],
  ["approvaldecision", "All decisions", [["decidedat", 150], ["actor", 160], ["outcome", 150], ["channel", 90], ["approvalrequest", 200], ["subjectrevisionreference", 170], ["comment", 300]], "", ["decidedat", true]],
  ["businessevent", "Business timeline", [["occurredat", 150], ["submission", 190], ["actor", 150], ["eventtype", 130], ["action", 300], ["oldstatus", 170], ["newstatus", 170], ["channel", 90], ["reason", 260]], "", ["occurredat", true]],
  ["communication", "Failed notifications", [["requestedat", 150], ["submission", 190], ["channel", 90], ["recipientuser", 150], ["subject", 260], ["attemptcount", 80], ["lasterrorcategory", 200]], `<condition attribute="${P}_state" operator="eq" value="${choice("commstate", "Failed")}" />`, ["requestedat", true]],
  ["communication", "All notifications", [["requestedat", 150], ["submission", 190], ["channel", 90], ["recipientuser", 150], ["subject", 260], ["state", 100], ["deliveredat", 150]], "", ["requestedat", true]],
  ["exportpackage", "Export history", [["requestedat", 150], ["submission", 190], ["exporttype", 150], ["status", 110], ["requestedby", 150], ["filename", 220], ["errorcategory", 180]], "", ["requestedat", true]],
  ["meeting", "Upcoming meetings", [["name", 220], ["committee", 170], ["startat", 150], ["endat", 150], ["status", 100], ["requestcloseat", 150], ["submissiondeadlineat", 150]], `<condition attribute="${P}_startat" operator="next-x-years" value="5" />`, ["startat", false]],
  ["slot", "All slots", [["slotreference", 150], ["meeting", 200], ["startat", 150], ["endat", 150], ["capacity", 80], ["activeallocationcount", 100], ["status", 100]], "", ["startat", false]],
  ["slotrequest", "Slot requests", [["submission", 200], ["revisionnumber", 80], ["status", 110], ["requestedslot", 150], ["assignedslot", 150], ["submittedat", 150], ["allocationactive", 100]], "", ["createdon", true]],
  ["signatory", "Current signatories", [["submission", 200], ["slotnumber", 70], ["person", 180], ["assignmentversion", 80], ["assignedat", 150]], `<condition attribute="${P}_iscurrent" operator="eq" value="1" />`, ["createdon", true]],
  ["sectioninstance", "Section status", [["submission", 200], ["sectiondef", 220], ["status", 150], ["isapplicable", 90], ["lastsubmittedat", 150], ["approvedat", 150]], "", ["createdon", true]],
  ["evidence", "Evidence", [["originalfilename", 240], ["submission", 190], ["versionnumber", 70], ["uploadedby", 150], ["uploadedat", 150], ["sizebytes", 100], ["uploadstatus", 110]], "", ["uploadedat", true]],
  ["sectiondef", "Sections by template", [["template", 180], ["displayorder", 70], ["code", 90], ["name", 260], ["requiresapproval", 110]], "", ["displayorder", false]],
  ["questiondef", "Questions by section", [["sectiondef", 200], ["displayorder", 70], ["code", 110], ["label", 380], ["answertype", 110], ["isrequired", 80], ["requiresevidence", 100]], "", ["displayorder", false]],
  ["reviewroute", "Review routes", [["sectiondef", 220], ["reviewteam", 170], ["routecode", 100], ["completionpolicy", 190], ["isactive", 80]], "", ["createdon", false]],
  ["template", "Checklist templates", [["name", 220], ["code", 110], ["version", 70], ["status", 110], ["publishedat", 150], ["effectivefrom", 150]], "", ["createdon", true]],
  ["committee", "Committees", [["name", 240], ["code", 100], ["defaulttimezone", 170], ["isactive", 80], ["adminteam", 170]], "", ["createdon", false]],
];

const colName = (c) => (c === "createdon" ? "createdon" : `${P}_${c}`);

async function upsertView([table, name, cols, filter, [orderCol, desc]]) {
  const entity = `${P}_${table}`;
  const meta = await api("GET", `EntityDefinitions(LogicalName='${entity}')?$select=ObjectTypeCode,PrimaryIdAttribute`);
  const fetchxml =
    `<fetch version="1.0" mapping="logical"><entity name="${entity}"><attribute name="${meta.PrimaryIdAttribute}" />` +
    cols.map(([c]) => `<attribute name="${colName(c)}" />`).join("") +
    `<order attribute="${colName(orderCol)}" descending="${desc ? "true" : "false"}" />` +
    `<filter type="and"><condition attribute="statecode" operator="eq" value="0" />${filter}</filter></entity></fetch>`;
  const layoutxml =
    `<grid name="resultset" object="${meta.ObjectTypeCode}" jump="${colName(cols[0][0])}" select="1" icon="1" preview="1">` +
    `<row name="result" id="${meta.PrimaryIdAttribute}">${cols.map(([c, w]) => `<cell name="${colName(c)}" width="${w}" />`).join("")}</row></grid>`;
  const found = await api("GET", `savedqueries?$select=savedqueryid&$filter=returnedtypecode eq '${entity}' and name eq '${name.replace(/'/g, "''")}' and querytype eq 0`);
  if (found.value.length) {
    await api("PATCH", `savedqueries(${found.value[0].savedqueryid})`, { fetchxml, layoutxml });
    return found.value[0].savedqueryid;
  }
  const made = await api("POST", "savedqueries", { name, returnedtypecode: entity, querytype: 0, fetchxml, layoutxml });
  return made.savedqueryid;
}

// ---- site map ---------------------------------------------------------------

const NAV = [
  ["Portfolio", [["submission", "Submissions"], ["approvalrequest", "Approval requests"], ["slotrequest", "Slot requests"], ["signatory", "Signatories"], ["sectioninstance", "Section status"], ["evidence", "Evidence"]]],
  ["Committee calendar", [["committee", "Committees"], ["meeting", "Meetings"], ["slot", "Slots"]]],
  ["Audit", [["businessevent", "Business timeline"], ["approvaldecision", "Decisions"], ["communication", "Notifications"], ["exportpackage", "Export history"]]],
  ["Configuration", [["template", "Checklist templates"], ["sectiondef", "Sections"], ["questiondef", "Questions"], ["questionoption", "Question options"], ["reviewroute", "Review routes"]]],
];

function siteMapXml(withWorkspace) {
  const title = (t) => `<Titles><Title LCID="1033" Title="${esc(t)}" /></Titles>`;
  const groups = NAV.map(
    ([g, items], gi) =>
      `<Group Id="${P}_group_${gi}" IsProfile="false">${title(g)}` +
      items.map(([t, label]) => `<SubArea Id="${P}_sub_${t}" Entity="${P}_${t}" VectorIcon="$webresource:${P}_/icons/${t}.svg">${title(label)}</SubArea>`).join("") +
      `</Group>`,
  ).join("");
  // The React workspace, shown only where webapp.mjs has uploaded it as a web resource.
  const workspace = `<Group Id="${P}_group_workspace" IsProfile="false">${title("Workspace")}<SubArea Id="${P}_sub_workspace" Url="$webresource:${P}_/app.html">${title("Portfolio studio")}</SubArea></Group>`;
  return `<SiteMap IntroducedVersion="7.0.0.0"><Area Id="${P}_area" ShowGroups="true">${title("NBPRA")}${withWorkspace ? workspace : ""}${groups}</Area></SiteMap>`;
}

// ---- run --------------------------------------------------------------------

const APP_UNIQUE = `${P}_Admin`;
const SITEMAP_UNIQUE = `${P}_AdminSiteMap`;

console.log(`Views (${VIEWS.length})`);
for (const v of VIEWS) await upsertView(v);

console.log("Navigation icons");
const SVG = 11;
for (const [, items] of NAV) {
  for (const [t] of items) {
    const name = `${P}_/icons/${t}.svg`;
    const content = readFileSync(join(here, `webresources/icons/${t}.svg`)).toString("base64");
    const found = (await api("GET", `webresourceset?$select=webresourceid&$filter=name eq '${name}'`)).value[0];
    if (found) await api("PATCH", `webresourceset(${found.webresourceid})`, { content });
    else await api("POST", "webresourceset", { name, displayname: `NBPRA icon: ${t}`, webresourcetype: SVG, content });
  }
}

console.log("Site map");
const hasWorkspace = (await api("GET", `webresourceset?$select=webresourceid&$filter=name eq '${P}_/app.html'`)).value.length > 0;
const sitemapxml = siteMapXml(hasWorkspace);
let sm = await api("GET", `sitemaps?$select=sitemapid&$filter=sitemapnameunique eq '${SITEMAP_UNIQUE}'`);
let sitemapid = sm.value[0]?.sitemapid;
if (sitemapid) await api("PATCH", `sitemaps(${sitemapid})`, { sitemapxml });
else sitemapid = (await api("POST", "sitemaps", { sitemapname: "NBPRA Admin", sitemapnameunique: SITEMAP_UNIQUE, sitemapxml })).sitemapid;

console.log("App");
const APP_QUERY = `appmodules/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()?$select=appmoduleid,uniquename&$filter=uniquename eq '${APP_UNIQUE}'`;
const apps = await api("GET", APP_QUERY);
let appid = apps.value[0]?.appmoduleid;
if (!appid) {
  // A new app is unpublished, so the create call cannot echo the record back.
  await api(
    "POST",
    "appmodules",
    {
      name: "NBPRA Admin",
      uniquename: APP_UNIQUE,
      description: "Kate's portfolio, audit and configuration workspace for NBPRA.",
      clienttype: 4,
      navigationtype: 0,
      webresourceid: "953b9fac-1e5e-e611-80d6-00155ded156f", // default app icon
    },
    { headers: { Prefer: "return=minimal" } },
  );
  appid = (await api("GET", APP_QUERY)).value[0].appmoduleid;
}
const tableIds = [];
for (const [, items] of NAV) {
  for (const [t] of items) tableIds.push((await api("GET", `EntityDefinitions(LogicalName='${P}_${t}')?$select=MetadataId`)).MetadataId);
}
await api("POST", "AddAppComponents", {
  AppId: appid,
  Components: [
    { "@odata.type": "Microsoft.Dynamics.CRM.sitemap", sitemapid },
    ...tableIds.map((entityid) => ({ "@odata.type": "Microsoft.Dynamics.CRM.entity", entityid })),
  ],
});

const check = await api("POST", `ValidateApp(AppModuleId=${appid})`).catch(async () => api("GET", `ValidateApp(AppModuleId=${appid})`));
const issues = check?.AppValidationResponse?.ValidationIssueList ?? [];
console.log(`Validation: ${check?.AppValidationResponse?.ValidationSuccess ? "passed" : "has issues"} (${issues.length} notes)`);
for (const i of issues.slice(0, 10)) console.log(`  ${i.ErrorType}: ${i.Message}`);

console.log("Publishing");
await api("POST", "PublishXml", { ParameterXml: `<importexportxml><appmodules><appmodule>${appid}</appmodule></appmodules><sitemaps><sitemap>${sitemapid}</sitemap></sitemaps></importexportxml>` }, { inSolution: false });
await api("POST", "PublishAllXml", {}, { inSolution: false });
console.log(`Done. App id ${appid}`);
console.log(`${urlArg.replace(/\/$/, "")}/main.aspx?appid=${appid}`);
