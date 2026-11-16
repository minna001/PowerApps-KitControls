"""Writes the NBPRA data dictionary workbook from the model that build.mjs prepares."""
import json
import sys

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

model = json.load(open(sys.argv[1], encoding="utf8"))
tables, relationships, choices = model["tables"], model["relationships"], model["choices"]
wb = Workbook()
HEAD = PatternFill("solid", fgColor="1F5F5B")


def sheet(title, headers, rows, widths, name):
    ws = wb.create_sheet(title)
    ws.append(headers)
    for r in rows:
        ws.append(r)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = HEAD
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"
    if rows:
        t = Table(displayName=name, ref=f"A1:{get_column_letter(len(headers))}{len(rows) + 1}")
        t.tableStyleInfo = TableStyleInfo(name="TableStyleLight1", showRowStripes=True)
        ws.add_table(t)
    return ws


custom = lambda t: [c for c in t["columns"] if c["origin"] != "Standard"]
readme = wb.active
readme.title = "Read me"
lines = [
    ("NBPRA data dictionary", True),
    (f"Generated {model['generated']} from dataverse/schema.json. Solution {model['solution']}, publisher prefix {model['prefix']}_.", False),
    ("", False),
    ("Sheets", True),
    (f"Tables: the {len(tables)} custom tables, what each is for, how it is owned and its keys.", False),
    (f"Columns: every column of every table ({sum(len(t['columns']) for t in tables)} rows). Origin says whether the solution adds the column (Custom) or Dataverse creates it on every table (Standard). Filter Origin to Custom for the {sum(len(custom(t)) for t in tables)} columns the solution defines.", False),
    (f"Relationships: the {len(relationships)} lookups between tables, all many-to-one from the table holding the lookup.", False),
    ("Alternate keys: column combinations that must be unique, used to stop duplicates.", False),
    (f"Choices: the {len(set(c['set'] for c in choices))} choice sets with each option's stored value.", False),
    ("", False),
    ("Conventions", True),
    ("Logical name is the name used in the Web API, flows and code. Display name is what people see on forms and views.", False),
    ("Data type is the Dataverse type. Generic type is the nearest general type (string, int, boolean, datetime, guid and so on).", False),
    ("Required: Yes means a value is needed to save from a form or import. System means Dataverse fills the column itself.", False),
    ("A choice column stores a whole number. Values are 774100000 plus the option's position in its list.", False),
    ("A lookup stores the id of a row in the related table. A required lookup blocks deleting the parent; an optional one is cleared if the parent is deleted.", False),
    ("Every table is audited. Approval Decision and Business Event are append-only: rows are added and never changed.", False),
    ("Tables owned by a user or team: " + model["ownedByUser"] + ". The rest are owned by the organization.", False),
]
for text, bold in lines:
    readme.append([text])
    cell = readme.cell(row=readme.max_row, column=1)
    cell.font = Font(bold=bold, size=14 if text == lines[0][0] else 11)
    cell.alignment = Alignment(wrap_text=True, vertical="top")
readme.column_dimensions["A"].width = 130

sheet(
    "Tables",
    ["Table", "Logical name", "Area", "Purpose", "Ownership", "Primary key", "Primary name", "Alternate keys", "Append-only", "Custom columns", "All columns", "Lookups out", "Lookups in"],
    [
        [
            t["display"], t["logical"], t["area"], t["description"], t["ownership"], t["logical"] + "id", model["prefix"] + "_name",
            "; ".join(" + ".join(k) for k in t["keys"]), "Yes" if t["appendOnly"] else "No", len(custom(t)), len(t["columns"]),
            sum(1 for r in relationships if r["child"] == t["name"]), sum(1 for r in relationships if r["parent"] == t["name"]),
        ]
        for t in tables
    ],
    [24, 26, 24, 70, 14, 28, 14, 46, 12, 10, 10, 10, 10],
    "Tables",
)
sheet(
    "Columns",
    ["Table", "Table logical name", "Column", "Logical name", "Data type", "Generic type", "Length or format", "Required", "Origin", "Key", "Related table or choice set", "Description"],
    [[t["display"], t["logical"], c["display"], c["logical"], c["dv"], c["generic"], c["detail"], c["required"], c["origin"], c["key"], c["target"], c["description"]] for t in tables for c in t["columns"]],
    [22, 24, 30, 32, 22, 20, 34, 10, 14, 22, 26, 70],
    "Columns",
)
sheet(
    "Relationships",
    ["Relationship (schema name)", "Many side (table with the lookup)", "Logical name", "Lookup column", "Lookup logical name", "One side (related table)", "Related logical name", "Cardinality", "Lookup required", "If the related row is deleted", "Meaning"],
    [[r["schemaName"], r["childDisplay"], r["childLogical"], r["columnDisplay"], r["column"], r["parentDisplay"], r["parentLogical"], "Many to one", "Yes" if r["required"] else "No", r["onDelete"], r["description"]] for r in relationships],
    [40, 24, 26, 26, 32, 24, 26, 12, 10, 44, 60],
    "Relationships",
)
sheet(
    "Alternate keys",
    ["Table", "Logical name", "Key columns (unique together)"],
    [[t["display"], t["logical"], " + ".join(k)] for t in tables for k in t["keys"]],
    [24, 26, 80],
    "AlternateKeys",
)
sheet("Choices", ["Choice set", "Value", "Label", "Used by"], [[c["set"], c["value"], c["label"], c["usedBy"]] for c in choices], [28, 14, 30, 90], "Choices")
wb.save(sys.argv[2])
print(f"NBPRA-data-dictionary.xlsx: {len(tables)} tables, {sum(len(t['columns']) for t in tables)} columns, {len(relationships)} relationships, {len(choices)} choice options")
