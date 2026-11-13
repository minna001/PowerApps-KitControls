#!/usr/bin/env node
// Checks the sample CSV files against a real environment's metadata before
// anyone imports them by hand: every file must match a table's display name,
// every header a column's display name, every choice cell one of that column's
// labels, and every lookup cell a name that an earlier file (or the same file)
// defines. Read-only.
//
//   node tests/check-sample-csv.mjs --url https://<org>.crm.dynamics.com --dir ../sample-data
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect } from "../dv.mjs";

const args = process.argv.slice(2);
const arg = (n) => args[args.indexOf(n) + 1];
const { api } = connect(arg("--url"));
const dir = arg("--dir");

function parse(text) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const tables = (await api("GET", "EntityDefinitions?$select=LogicalName,DisplayName")).value.filter((t) => t.LogicalName.startsWith("nbpra_"));
const dup = {}; // table logical name -> names used by more than one row
const names = {}; // table logical name -> set of row names defined by the files so far
let problems = 0;
const bad = (m) => { problems++; console.log("  PROBLEM: " + m); };

for (const file of readdirSync(dir).filter((f) => f.endsWith(".csv")).sort()) {
  const display = file.replace(/^\d+ /, "").replace(/\.csv$/, "");
  const table = tables.find((t) => t.DisplayName?.UserLocalizedLabel?.Label === display);
  console.log(`${file} -> ${table?.LogicalName ?? "?"}`);
  if (!table) { bad(`no table is displayed as "${display}"`); continue; }
  const attrs = (await api("GET", `EntityDefinitions(LogicalName='${table.LogicalName}')/Attributes?$select=LogicalName,DisplayName,AttributeType`)).value;
  const picklists = (await api("GET", `EntityDefinitions(LogicalName='${table.LogicalName}')/Attributes/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$select=LogicalName&$expand=OptionSet($select=Options)`)).value;
  const lookups = (await api("GET", `EntityDefinitions(LogicalName='${table.LogicalName}')/Attributes/Microsoft.Dynamics.CRM.LookupAttributeMetadata?$select=LogicalName,Targets`)).value;
  const [headers, ...rows] = parse(readFileSync(join(dir, file), "utf8").replace(/^﻿/, ""));
  names[table.LogicalName] ??= new Set();
  const nameCol = headers.indexOf("Name");
  for (const r of rows) names[table.LogicalName].add(r[nameCol]);
  // A name only has to be unique where a later file looks rows up by it.
  const seen = new Set();
  dup[table.LogicalName] = new Set(rows.map((r) => r[nameCol]).filter((n) => seen.has(n) || !seen.add(n)));

  headers.forEach((h, i) => {
    const matches = attrs.filter((a) => a.DisplayName?.UserLocalizedLabel?.Label === h);
    if (matches.length !== 1) return bad(`header "${h}" matches ${matches.length} columns`);
    const a = matches[0];
    const values = rows.map((r) => r[i]).filter((v) => v !== "");
    const pick = picklists.find((p) => p.LogicalName === a.LogicalName);
    if (pick) {
      const labels = pick.OptionSet.Options.map((o) => o.Label.UserLocalizedLabel?.Label);
      for (const v of new Set(values)) if (!labels.includes(v)) bad(`"${h}" value "${v}" is not one of: ${labels.join(", ")}`);
    }
    const look = lookups.find((l) => l.LogicalName === a.LogicalName);
    if (look) {
      const target = look.Targets[0];
      for (const v of new Set(values)) {
        if (!names[target]?.has(v)) bad(`"${h}" refers to "${v}", which no earlier file defines in ${target}`);
        else if (dup[target]?.has(v)) bad(`"${h}" refers to "${v}", but more than one ${target} row has that name`);
      }
    }
    if (a.AttributeType === "DateTime") for (const v of values) if (Number.isNaN(Date.parse(v))) bad(`"${h}" value "${v}" is not a date`);
    if (a.AttributeType === "Boolean") for (const v of new Set(values)) if (!["Yes", "No"].includes(v)) bad(`"${h}" value "${v}" is not Yes or No`);
  });
}
console.log(problems ? `${problems} problem(s).` : "All files match the environment's tables, columns, choices and lookups.");
process.exit(problems ? 1 : 0);
