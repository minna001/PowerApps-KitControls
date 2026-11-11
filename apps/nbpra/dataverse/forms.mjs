#!/usr/bin/env node
// Rebuilds the main form of every NBPRA table from schema.json: all columns in
// a two-column General tab, plus related-record tabs where listed in RELATED.
// Safe to re-run; each form is replaced in place.
//
//   node forms.mjs --url https://<org>.crm.dynamics.com
import { randomUUID } from "node:crypto";
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
const g = () => `{${randomUUID().toUpperCase()}}`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const CLASS = {
  text: "{4273EDBD-AC1D-40d3-9FB2-095C621B552D}",
  autonumber: "{4273EDBD-AC1D-40d3-9FB2-095C621B552D}",
  memo: "{E0DECE4B-6FC8-4a8f-A065-082708572369}",
  int: "{C6D124CA-7EDA-4a60-AEA9-7FB8D318B68F}",
  decimal: "{C3EFE0C3-0EC6-42be-8349-CBD9079DFD8E}",
  money: "{533B9E00-756B-4312-95A0-DC888637AC78}",
  bool: "{67FAC785-CD58-4f9f-ABB3-4B7DDC6ED5ED}",
  datetime: "{5B773807-9FB2-42db-97C3-7A91EFF8ADFF}",
  date: "{5B773807-9FB2-42db-97C3-7A91EFF8ADFF}",
  choice: "{3EF39988-22BB-4f0b-BBBE-64B5A3748AEE}",
  lookup: "{270BD3DB-D9AF-4782-9025-509E298DEC0A}",
};
const SUBGRID = "{E7A81278-8635-4d9e-8D4D-59480B391C5B}";

// Columns only server-side operations may change; shown read-only.
const PROTECTED = {
  submission: ["reference", "status", "packagerevision", "currentslotrequest", "assignedslot", "checklisttemplate", "finalsubmittedat", "committeeauthorizedat", "committeeauthorizedby", "lastbusinessactivityat", "withdrawnat"],
  slot: ["activeallocationcount"],
};
const READ_ONLY_TABLES = ["approvaldecision", "businessevent", "approvalassignment", "approvalrequest", "slotrequest", "communication", "exportpackage", "sectionrevision", "answer"];

// table -> [tab label, child table, child lookup column, view name]
const RELATED = {
  submission: [
    ["Sections", "sectioninstance", "submission", "Section status"],
    ["Signatories", "signatory", "submission", "Current signatories"],
    ["Approvals", "approvalrequest", "submission", "All approval requests"],
    ["Slot requests", "slotrequest", "submission", "Slot requests"],
    ["Evidence", "evidence", "submission", "Evidence"],
    ["Timeline", "businessevent", "submission", "Business timeline"],
    ["Notifications", "communication", "submission", "All notifications"],
  ],
  approvalrequest: [["Decisions", "approvaldecision", "approvalrequest", "All decisions"]],
  committee: [["Meetings", "meeting", "committee", "Upcoming meetings"]],
  meeting: [["Slots", "slot", "meeting", "All slots"]],
  template: [["Sections", "sectiondef", "template", "Sections by template"]],
  sectiondef: [
    ["Questions", "questiondef", "sectiondef", "Questions by section"],
    ["Review routes", "reviewroute", "sectiondef", "Review routes"],
  ],
};

const label = (t) => `<labels><label description="${esc(t)}" languagecode="1033" /></labels>`;
const pretty = (name) => name.replace(/at$/, " at").replace(/by$/, " by").replace(/^is/, "Is ").replace(/^./, (c) => c.toUpperCase());

function fieldCell(table, [name, type], displayNames) {
  const kind = type.split(":")[0];
  if (!CLASS[kind]) return null; // file and bigint columns have no simple form control
  const disabled = READ_ONLY_TABLES.includes(table.name) || (PROTECTED[table.name] ?? []).includes(name);
  const text = displayNames[`${P}_${name}`] ?? pretty(name);
  return `<cell id="${g()}">${label(text)}<control id="${P}_${name}" classid="${CLASS[kind]}" datafieldname="${P}_${name}"${disabled ? ' disabled="true"' : ""} /></cell>`;
}

async function viewId(childTable, name) {
  const r = await api("GET", `savedqueries?$select=savedqueryid&$filter=returnedtypecode eq '${P}_${childTable}' and name eq '${name}' and querytype eq 0`);
  if (!r.value.length) throw new Error(`View "${name}" on ${childTable} not found; run mda.mjs first.`);
  return `{${r.value[0].savedqueryid.toUpperCase()}}`;
}

async function buildForm(table, displayNames) {
  const cells = [
    `<cell id="${g()}">${label("Name")}<control id="${P}_name" classid="${CLASS.text}" datafieldname="${P}_name" /></cell>`,
    ...table.columns.map((c) => fieldCell(table, c, displayNames)).filter(Boolean),
  ];
  if (table.ownership === "user") cells.push(`<cell id="${g()}">${label("Owner")}<control id="ownerid" classid="${CLASS.lookup}" datafieldname="ownerid" /></cell>`);
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(`<row>${cells[i]}${cells[i + 1] ?? `<cell id="${g()}" showlabel="false"><labels><label description="" languagecode="1033" /></labels></cell>`}</row>`);

  let tabs =
    `<tab verticallayout="true" id="${g()}" IsUserDefined="1" name="tab_general">${label("General")}<columns><column width="100%"><sections>` +
    `<section showlabel="false" showbar="false" IsUserDefined="0" id="${g()}" columns="11" name="sec_general">${label("General")}<rows>${rows.join("")}</rows></section>` +
    `</sections></column></columns></tab>`;

  for (const [tabLabel, child, lookup, view] of RELATED[table.name] ?? []) {
    const vid = await viewId(child, view);
    const span = 12;
    tabs +=
      `<tab verticallayout="true" id="${g()}" IsUserDefined="1" name="tab_${child}">${label(tabLabel)}<columns><column width="100%"><sections>` +
      `<section showlabel="false" showbar="false" IsUserDefined="0" id="${g()}" name="sec_${child}">${label(tabLabel)}<rows>` +
      `<row><cell id="${g()}" rowspan="${span}" colspan="1" auto="false" showlabel="false">${label(tabLabel)}` +
      `<control id="Subgrid_${child}" classid="${SUBGRID}" indicationOfSubgrid="true" uniqueid="${g()}"><parameters>` +
      `<ViewId>${vid}</ViewId><IsUserView>false</IsUserView><RelationshipName>${P}_${child}_${lookup}</RelationshipName>` +
      `<TargetEntityType>${P}_${child}</TargetEntityType><AutoExpand>Fixed</AutoExpand><EnableQuickFind>false</EnableQuickFind>` +
      `<EnableViewPicker>false</EnableViewPicker><ViewIds>${vid}</ViewIds><EnableJumpBar>false</EnableJumpBar><ChartGridMode>Grid</ChartGridMode>` +
      `<RecordsPerPage>10</RecordsPerPage><EnableChartPicker>false</EnableChartPicker></parameters></control></cell></row>` +
      "<row />".repeat(span - 1) +
      `</rows></section></sections></column></columns></tab>`;
  }
  return `<form><tabs>${tabs}</tabs></form>`;
}

let done = 0;
for (const table of schema.tables) {
  const entity = `${P}_${table.name}`;
  const attrs = await api("GET", `EntityDefinitions(LogicalName='${entity}')/Attributes?$select=LogicalName,DisplayName`);
  const displayNames = Object.fromEntries(attrs.value.map((a) => [a.LogicalName, a.DisplayName?.UserLocalizedLabel?.Label]).filter(([, v]) => v));
  const forms = await api("GET", `systemforms?$select=formid&$filter=objecttypecode eq '${entity}' and type eq 2`);
  if (!forms.value.length) {
    console.log(`  ${table.name}: no main form found, skipped`);
    continue;
  }
  await api("PATCH", `systemforms(${forms.value[0].formid})`, { formxml: await buildForm(table, displayNames) });
  done++;
}
console.log(`Forms updated: ${done} of ${schema.tables.length}. Publishing`);
await api("POST", "PublishAllXml", {}, { inSolution: false });
console.log("Done.");
