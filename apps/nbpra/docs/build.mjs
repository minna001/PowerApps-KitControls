#!/usr/bin/env node
// Builds the two data-model documents from dataverse/schema.json:
//
//   NBPRA-data-model.pdf        entity-relationship drawings (overview, then one page per area)
//   NBPRA-data-dictionary.xlsx  every table, column, relationship, key and choice
//
//   node docs/build.mjs        (needs Graphviz `dot`, Playwright's Chromium and Python with openpyxl)
//
// Re-run after any change to schema.json so the documents never drift from it.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { columnLabel } from "../dataverse/labels.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "../dataverse/schema.json"), "utf8"));
const P = schema.publisherPrefix;
const BASE = 774100000;

// ---- the model, in document terms ---------------------------------------------

const SYSTEM = { systemuser: "User", team: "Team", businessunit: "Business Unit", organization: "Organization" };
const AREAS = [
  ["Committee calendar", ["committee", "meeting", "slot", "slotrequest"]],
  ["Submission and signatories", ["submission", "signatory", "riskrating"]],
  ["Checklist definition", ["template", "sectiondef", "questiondef", "questionoption", "reviewroute"]],
  ["Checklist responses", ["sectioninstance", "sectionrevision", "answer", "evidence"]],
  ["Approvals", ["approvalrequest", "approvalassignment", "approvaldecision"]],
  ["Audit and outputs", ["businessevent", "communication", "exportpackage"]],
];
const areaOf = (name) => AREAS.find(([, t]) => t.includes(name))?.[0];
for (const t of schema.tables) if (!areaOf(t.name)) throw new Error(`${t.name} is not in any diagram area`);

function typeOf(type) {
  const [kind, arg] = type.split(/:(.*)/s);
  switch (kind) {
    case "text": return { dv: "Single line of text", generic: "string", detail: `max ${arg} characters`, short: `string(${arg})` };
    case "autonumber": return { dv: "Autonumber (text)", generic: "string", detail: `max 100 characters; format ${arg}`, short: "string(100) auto" };
    case "memo": return { dv: "Multiple lines of text", generic: "string (long)", detail: "max 1,048,576 characters", short: "text" };
    case "int": return { dv: "Whole number", generic: "int", detail: "32-bit, -2,147,483,648 to 2,147,483,647", short: "int" };
    case "bigint": return { dv: "Big integer", generic: "bigint", detail: "64-bit", short: "bigint" };
    case "decimal": return { dv: "Decimal number", generic: "decimal", detail: "precision 4", short: "decimal" };
    case "money": return { dv: "Currency", generic: "money", detail: "precision 2", short: "money" };
    case "bool": return { dv: "Yes/No", generic: "boolean", detail: "default No", short: "boolean" };
    case "datetime": return { dv: "Date and time", generic: "datetime", detail: "user local", short: "datetime" };
    case "date": return { dv: "Date only", generic: "date", detail: "date only", short: "date" };
    case "choice": return { dv: "Choice", generic: "int (option value)", detail: `choice set ${P}_${arg}`, short: "choice", choice: arg };
    case "lookup": return { dv: "Lookup", generic: "guid (foreign key)", detail: `to ${SYSTEM[arg] ?? schema.tables.find((t) => t.name === arg).display}`, short: "lookup", target: arg };
    case "file": return { dv: "File", generic: "binary", detail: "max 32 MB", short: "file" };
    default: throw new Error(`Unknown type ${type}`);
  }
}

const std = (logical, display, dv, generic, detail, description, extra = {}) => ({ logical, display, dv, generic, detail, required: extra.required ?? "System", origin: "Standard", key: extra.key ?? "", target: extra.target ?? "", description });
function standardColumns(t) {
  const owner = t.ownership === "user"
    ? [
        std("ownerid", "Owner", "Owner", "guid (foreign key)", "to User or Team", "User or team that owns the row", { target: "systemuser, team", required: "Yes" }),
        std("owningbusinessunit", "Owning business unit", "Lookup", "guid (foreign key)", "to Business Unit", "Business unit of the owner", { target: "businessunit" }),
        std("owninguser", "Owning user", "Lookup", "guid (foreign key)", "to User", "Owner, when the owner is a user", { target: "systemuser" }),
        std("owningteam", "Owning team", "Lookup", "guid (foreign key)", "to Team", "Owner, when the owner is a team", { target: "team" }),
      ]
    : [std("organizationid", "Organization", "Lookup", "guid (foreign key)", "to Organization", "The organization; this table is not owned by individual users", { target: "organization" })];
  return [
    std("createdon", "Created on", "Date and time", "datetime", "user local", "When the row was created"),
    std("createdby", "Created by", "Lookup", "guid (foreign key)", "to User", "Who created the row", { target: "systemuser" }),
    std("createdonbehalfby", "Created by (delegate)", "Lookup", "guid (foreign key)", "to User", "Delegate who created the row for someone else", { target: "systemuser" }),
    std("modifiedon", "Modified on", "Date and time", "datetime", "user local", "When the row was last changed"),
    std("modifiedby", "Modified by", "Lookup", "guid (foreign key)", "to User", "Who last changed the row", { target: "systemuser" }),
    std("modifiedonbehalfby", "Modified by (delegate)", "Lookup", "guid (foreign key)", "to User", "Delegate who last changed the row for someone else", { target: "systemuser" }),
    ...owner,
    std("statecode", "Status", "Status (state)", "int (option value)", "0 Active, 1 Inactive", "Whether the row is active. Separate from the table's own business status column"),
    std("statuscode", "Status reason", "Status reason", "int (option value)", "1 Active, 2 Inactive", "Reason for the row's active or inactive state"),
    std("versionnumber", "Version number", "Big integer", "bigint", "row version", "Changes on every update; used to detect concurrent changes"),
    std("importsequencenumber", "Import sequence number", "Whole number", "int", "32-bit", "Sequence number of the import that created the row"),
    std("overriddencreatedon", "Record created on", "Date only", "datetime", "date only", "Original creation date for migrated rows"),
    std("timezoneruleversionnumber", "Time zone rule version number", "Whole number", "int", "32-bit", "For internal use"),
    std("utcconversiontimezonecode", "UTC conversion time zone code", "Whole number", "int", "32-bit", "Time zone code in use when the row was created"),
  ];
}

const tables = schema.tables.map((t) => {
  const logical = `${P}_${t.name}`;
  const inKey = (c) => (t.keys ?? []).some((k) => k.includes(c));
  const custom = t.columns.flatMap(([name, type, required, note]) => {
    const ty = typeOf(type);
    const col = {
      logical: `${P}_${name}`, display: columnLabel(t.display, name), dv: ty.dv, generic: ty.generic, detail: ty.detail, short: ty.short,
      required: required ? "Yes" : "No", origin: "Custom",
      key: [ty.target ? "Foreign key" : "", inKey(name) ? "Alternate key" : ""].filter(Boolean).join(", "),
      target: ty.target ? (SYSTEM[ty.target] ? ty.target : `${P}_${ty.target}`) : ty.choice ? `${P}_${ty.choice}` : "",
      description: note, name, lookup: ty.target, optional: !required,
    };
    // Dataverse adds a companion text column holding a file column's file name.
    return ty.short === "file" ? [col, { ...std(`${P}_${name}_name`, `${col.display} name`, "Single line of text", "string", "file name", "File name of the stored file, maintained by Dataverse"), origin: "Custom (system-maintained)" }] : [col];
  });
  return {
    name: t.name, logical, display: t.display, ownership: t.ownership === "user" ? "User or team" : "Organization", area: areaOf(t.name),
    description: t.note ?? "", appendOnly: !!t.appendOnly, keys: (t.keys ?? []).map((k) => k.map((c) => `${P}_${c}`)),
    columns: [
      { ...std(`${logical}id`, t.display, "Unique identifier", "guid", "primary key", "Unique identifier of the row", { key: "Primary key", required: "Yes" }), short: "guid" },
      { ...std(`${P}_name`, "Name", "Single line of text", "string", "max 200 characters", "Primary name shown in lookups and views", { key: "Primary name", required: "No" }), origin: "Custom", short: "string(200)" },
      ...custom,
      ...standardColumns(t),
    ],
  };
});
const byName = Object.fromEntries(tables.map((t) => [t.name, t]));

const relationships = tables.flatMap((t) =>
  t.columns.filter((c) => c.lookup).map((c) => ({
    schemaName: `${P}_${t.name}_${c.name}`, child: t.name, childDisplay: t.display, childLogical: t.logical, column: c.logical, columnDisplay: c.display,
    parent: c.lookup, parentDisplay: SYSTEM[c.lookup] ?? byName[c.lookup].display, parentLogical: SYSTEM[c.lookup] ? c.lookup : `${P}_${c.lookup}`,
    required: !c.optional, onDelete: c.optional ? "Remove link (the child keeps its row, the lookup is cleared)" : "Restrict (the parent cannot be deleted while children exist)",
    description: c.description,
  })),
);
const choices = Object.entries(schema.choices).flatMap(([set, labels]) =>
  labels.map((label, i) => ({ set: `${P}_${set}`, value: BASE + i, label, usedBy: tables.flatMap((t) => t.columns.filter((c) => c.target === `${P}_${set}`).map((c) => `${t.display}.${c.display}`)).join("; ") })),
);

// ---- drawings ------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const COLOR = { "Committee calendar": "#1f5f5b", "Submission and signatories": "#7a4b12", "Checklist definition": "#3b4f8a", "Checklist responses": "#5a3d7a", Approvals: "#8a2f3b", "Audit and outputs": "#4a4a4a" };

function node(t, full) {
  const head = `<TR><TD COLSPAN="3" BGCOLOR="${COLOR[t.area]}" ALIGN="LEFT" PORT="top"><FONT COLOR="white"><B>${esc(t.display)}</B></FONT><FONT COLOR="#ffffffcc" POINT-SIZE="9">  ${t.logical}</FONT></TD></TR>`;
  const row = (mark, name, type, port, grey) =>
    `<TR><TD ALIGN="LEFT" WIDTH="22"><FONT POINT-SIZE="8" COLOR="#8a6d1c">${mark || " "}</FONT></TD><TD ALIGN="LEFT"><FONT${grey ? ' COLOR="#777777"' : ""}>${esc(name)}</FONT></TD><TD ALIGN="LEFT" PORT="${port}"><FONT COLOR="#5c6464" POINT-SIZE="9">${esc(type) || " "}</FONT></TD></TR>`;
  const cols = t.columns.filter((c) => c.origin !== "Standard" || c.key === "Primary key");
  const shown = full ? cols : cols.filter((c) => c.key);
  const rows = shown.map((c) => {
    const mark = c.key === "Primary key" ? "PK" : [c.lookup ? "FK" : "", c.key.includes("Alternate") ? "AK" : ""].filter(Boolean).join(" ");
    const type = c.lookup ? `→ ${SYSTEM[c.lookup] ?? byName[c.lookup].display}` : c.short ?? c.generic;
    return row(mark, c.logical + (c.required === "Yes" && c.key !== "Primary key" ? " *" : ""), type, c.name ?? "pk");
  });
  const more = full ? row("", "+ standard columns (see legend)", "", "std", true) : row("", `+ ${cols.length - shown.length} more columns`, "", "more", true);
  return `"${t.name}" [label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="3" BGCOLOR="white" COLOR="${COLOR[t.area]}">${head}${rows.join("")}${more}</TABLE>>];`;
}
const stub = (name, system) =>
  `"${name}" [label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="5" BGCOLOR="${system ? "#eeeeee" : "#f6f4ee"}" COLOR="#999999" STYLE="${system ? "ROUNDED" : "DASHED"}"><TR><TD PORT="top"><FONT COLOR="#444444"><B>${esc(system ? SYSTEM[name] : byName[name].display)}</B></FONT><FONT COLOR="#777777" POINT-SIZE="9">  ${system ? "standard table" : byName[name].area}</FONT></TD></TR></TABLE>>];`;
const edge = (r, ports) =>
  `"${r.child}"${ports ? `:"${r.column.slice(P.length + 1)}"` : ""} -> "${r.parent}"${ports ? ':"top"' : ""} [dir=both, arrowtail=crow, arrowhead=${r.required ? "tee" : "odot"}, style=${r.required ? "solid" : "dashed"}, color="#55606a"];`;
const graph = (body, opts = "") => `digraph G { graph [rankdir=LR, splines=true, nodesep=0.35, ranksep=1.1, fontname="Helvetica", bgcolor="transparent" ${opts}]; node [shape=plain, fontname="Helvetica", fontsize=10]; edge [fontname="Helvetica", fontsize=8, arrowsize=0.8];\n${body}\n}`;

function overview() {
  const clusters = AREAS.map(([area, names], i) => `subgraph cluster_${i} { label="${area}"; labeljust=l; fontsize=13; fontcolor="${COLOR[area]}"; color="${COLOR[area]}55"; style="rounded"; margin=14;\n${names.map((n) => node(byName[n], false)).join("\n")}\n}`);
  // Lookups to standard tables are left off the overview; they are on the area pages.
  const edges = relationships.filter((r) => !SYSTEM[r.parent]).map((r) => edge(r, false));
  return graph([...clusters, ...edges].join("\n"), ", ranksep=1.4");
}
function areaPage(area, names) {
  const inside = new Set(names);
  // Lookups to User and Team are named in the type column ("→ User") rather than drawn, to keep the lines readable.
  const rels = relationships.filter((r) => !SYSTEM[r.parent] && (inside.has(r.child) || inside.has(r.parent)));
  const outside = [...new Set(rels.flatMap((r) => [r.child, r.parent]).filter((n) => !inside.has(n)))];
  return graph([
    ...names.map((n) => node(byName[n], true)),
    ...outside.map((n) => stub(n, !!SYSTEM[n])),
    ...rels.map((r) => `"${r.child}"${inside.has(r.child) ? `:"${r.column.slice(P.length + 1)}":e` : ""} -> "${r.parent}"${inside.has(r.parent) ? ':"top":w' : ""} [dir=both, arrowtail=crow, arrowhead=${r.required ? "tee" : "odot"}, style=${r.required ? "solid" : "dashed"}, color="#55606a"];`),
  ].join("\n"));
}

const tmp = mkdtempSync(join(tmpdir(), "nbpra-docs-"));
const svg = (dot) => execFileSync("dot", ["-Tsvg"], { input: dot, maxBuffer: 64 << 20 }).toString().replace(/^[\s\S]*?(<svg)/, "$1").replace(/<svg width="[^"]+" height="[^"]+"/, "<svg");

const legend = `<div class="legend"><b>Reading the drawing.</b> A line runs from the table holding the lookup (crow's foot, "many") to the table it points at ("one"). Solid line with a bar: the lookup is required. Dashed line with a circle: optional. <b>PK</b> primary key, <b>FK</b> lookup (foreign key), <b>AK</b> part of an alternate key, <b>*</b> required. Column names are Dataverse logical names. Lookups to the standard User and Team tables are named in the type column ("→ User") and not drawn.</div>`;
const standardLegend = `<div class="legend"><b>Standard columns on every table</b> (created by Dataverse, not listed in the boxes): createdon <i>datetime</i>, createdby <i>→ User</i>, createdonbehalfby <i>→ User</i>, modifiedon <i>datetime</i>, modifiedby <i>→ User</i>, modifiedonbehalfby <i>→ User</i>, statecode <i>int (0 Active, 1 Inactive)</i>, statuscode <i>int</i>, versionnumber <i>bigint</i>, importsequencenumber <i>int</i>, overriddencreatedon <i>datetime</i>, timezoneruleversionnumber <i>int</i>, utcconversiontimezonecode <i>int</i>. User-owned tables add ownerid <i>→ User or Team</i>, owningbusinessunit, owninguser, owningteam; organization-owned tables add organizationid.</div>`;
const today = new Date().toISOString().slice(0, 10);
const page = (title, sub, body, extra = "") => `<section><header><div><div class="eyebrow">NBPRA data model</div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div><div class="stamp">Generated ${today} from schema.json<br>${tables.length} tables · ${relationships.length} relationships</div></header><div class="canvas">${body}</div>${legend}${extra}</section>`;
const ownedBy = (kind) => tables.filter((t) => t.ownership === kind).map((t) => t.display).join(", ");
const pages = [
  page("Overview", "Every custom table with its keys and lookups, grouped by area. The area pages that follow list every column.", svg(overview())),
  ...AREAS.map(([area, names]) =>
    page(area, names.map((n) => `${byName[n].display}: ${byName[n].description}`).join("  "), svg(areaPage(area, names)), standardLegend),
  ),
];
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A3 landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Helvetica, Arial, sans-serif; color: #1c2526; }
section { width: 420mm; height: 296.5mm; padding: 11mm 12mm 9mm; display: flex; flex-direction: column; page-break-after: always; overflow: hidden; }
header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12mm; border-bottom: 1.5px solid #1f5f5b; padding-bottom: 4mm; }
.eyebrow { font-size: 9pt; letter-spacing: .12em; text-transform: uppercase; color: #1f5f5b; }
h1 { margin: 1mm 0 1.5mm; font-size: 22pt; font-weight: 600; }
header p { margin: 0; font-size: 8.5pt; color: #4c5556; max-width: 300mm; line-height: 1.35; }
.stamp { font-size: 8pt; color: #5c6464; text-align: right; white-space: nowrap; }
.canvas { flex: 1; min-height: 0; padding: 4mm 0; display: flex; }
.canvas svg { width: 100%; height: 100%; }
.legend { font-size: 8pt; color: #3c4546; line-height: 1.4; border-top: 1px solid #ddd8cb; padding-top: 2mm; margin-top: 1mm; }
.legend i { color: #5c6464; }
</style></head><body>${pages.join("")}</body></html>`;
writeFileSync(join(tmp, "model.html"), html);

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const browser = await chromium.launch();
const tab = await browser.newPage();
await tab.goto("file://" + join(tmp, "model.html"));
await tab.pdf({ path: join(here, "NBPRA-data-model.pdf"), format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
for (const [i] of pages.entries()) {
  await tab.setViewportSize({ width: 1587, height: 1122 });
  await tab.evaluate((n) => document.querySelectorAll("section")[n].scrollIntoView(), i);
  await tab.screenshot({ path: join(tmp, `page-${i + 1}.png`) });
}
await browser.close();
console.log(`NBPRA-data-model.pdf: ${pages.length} pages (previews in ${tmp})`);

// ---- dictionary ----------------------------------------------------------------

const model = { generated: today, solution: schema.solution, prefix: P, ownedByUser: ownedBy("User or team"), tables, relationships, choices };
writeFileSync(join(tmp, "model.json"), JSON.stringify(model));
console.log(execFileSync("python3", ["-I", join(here, "dictionary.py"), join(tmp, "model.json"), join(here, "NBPRA-data-dictionary.xlsx")]).toString().trim());
