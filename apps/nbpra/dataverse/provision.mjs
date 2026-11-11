#!/usr/bin/env node
// Creates the NBPRA publisher, solution, choices, tables, columns, lookups and
// alternate keys in a Dataverse environment from schema.json. Safe to re-run:
// anything that already exists is skipped.
//
//   node provision.mjs --url https://<org>.crm.dynamics.com            (device-code sign-in)
//   node provision.mjs --url https://<org>.crm.dynamics.com --dry-run  (no network; writes plan.json)
//   node provision.mjs --url https://<org>.crm.dynamics.com --verify   (read-only check against schema.json)
//
// Behind a proxy, run with NODE_USE_ENV_PROXY=1 (Node 22.21+).
// Service principal instead of device code: set DV_TENANT, DV_CLIENT_ID, DV_CLIENT_SECRET.
//
// NOT YET RUN AGAINST A REAL ENVIRONMENT.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, "schema.json"), "utf8"));
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
const dryRun = flag("--dry-run");
const url = (opt("--url") ?? "https://example.crm.dynamics.com").replace(/\/$/, "");
if (!dryRun && !opt("--url")) {
  console.error("Pass --url https://<org>.crm.dynamics.com (or --dry-run).");
  process.exit(1);
}

const P = schema.publisherPrefix;
const OPTION_PREFIX = 77410; // publisher choice-value prefix
const SYSTEM_TABLES = { systemuser: "systemuserid", team: "teamid" };
const ln = (name) => (name in SYSTEM_TABLES ? name : `${P}_${name}`);
const label = (text) => ({ LocalizedLabels: [{ Label: text, LanguageCode: 1033 }] });
const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plan = [];
const choiceIds = {}; // choice name -> MetadataId; a column must bind to its choice by id

// ---- auth -------------------------------------------------------------------

// Optional: DV_TOKEN_FILE names a private file (outside the repo) where this
// script keeps its own access token for up to an hour, so repeat runs in one
// working session do not each need a new sign-in.
function cachedToken() {
  const f = process.env.DV_TOKEN_FILE;
  if (!f || !existsSync(f)) return undefined;
  const c = JSON.parse(readFileSync(f, "utf8"));
  return c.url === url && c.expires > Date.now() + 5 * 60000 ? c.token : undefined;
}
function cacheToken(j) {
  const f = process.env.DV_TOKEN_FILE;
  if (f) writeFileSync(f, JSON.stringify({ url, token: j.access_token, expires: Date.now() + j.expires_in * 1000 }), { mode: 0o600 });
  return j.access_token;
}

async function getToken() {
  const c = cachedToken();
  if (c) return c;
  const { DV_TENANT, DV_CLIENT_ID, DV_CLIENT_SECRET } = process.env;
  const scope = `${url}/.default`;
  if (DV_TENANT && DV_CLIENT_ID && DV_CLIENT_SECRET) {
    const r = await fetch(`https://login.microsoftonline.com/${DV_TENANT}/oauth2/v2.0/token`, {
      method: "POST",
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: DV_CLIENT_ID, client_secret: DV_CLIENT_SECRET, scope }),
    });
    const j = await r.json();
    if (!j.access_token) throw new Error(`Sign-in failed: ${j.error_description ?? r.status}`);
    return j.access_token;
  }
  // Public client ID Microsoft publishes for Dataverse developer tooling.
  const client_id = "51f81489-12ee-4a9e-aaae-a2591f45987d";
  const base = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
  const dc = await (await fetch(`${base}/devicecode`, { method: "POST", body: new URLSearchParams({ client_id, scope }) })).json();
  if (!dc.device_code) throw new Error(`Device-code request failed: ${dc.error_description}`);
  console.log(`\n${dc.message}\n`);
  for (;;) {
    await new Promise((r) => setTimeout(r, (dc.interval ?? 5) * 1000));
    const j = await (
      await fetch(`${base}/token`, {
        method: "POST",
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id, device_code: dc.device_code }),
      })
    ).json();
    if (j.access_token) return cacheToken(j);
    if (j.error !== "authorization_pending") throw new Error(`Sign-in failed: ${j.error_description}`);
  }
}

let token;
async function api(method, path, body, { solution = true } = {}) {
  if (dryRun) {
    if (method !== "GET") plan.push({ method, path, body });
    return method === "GET" ? null : {};
  }
  const r = await fetch(`${url}/api/data/v9.2/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "OData-Version": "4.0",
      Accept: "application/json",
      ...(solution && method !== "GET" ? { "MSCRM.SolutionUniqueName": schema.solution } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === "GET" && r.status === 404) return null;
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}\n${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}
const exists = async (path) => (await api("GET", path)) !== null;
const step = (msg) => console.log(msg);

// ---- column payloads --------------------------------------------------------

const T = (name) => `Microsoft.Dynamics.CRM.${name}`;

function columnPayload(table, [name, type, required, note]) {
  const [kind, arg] = type.split(/:(.*)/s);
  const base = {
    SchemaName: `${P}_${name}`,
    DisplayName: label(titleCase(name)),
    Description: label(note || ""),
    RequiredLevel: { Value: required ? "ApplicationRequired" : "None" },
    IsAuditEnabled: { Value: true },
  };
  switch (kind) {
    case "text":
      return { ...base, "@odata.type": T("StringAttributeMetadata"), MaxLength: Number(arg), FormatName: { Value: "Text" } };
    case "autonumber":
      return { ...base, "@odata.type": T("StringAttributeMetadata"), MaxLength: 100, FormatName: { Value: "Text" }, AutoNumberFormat: arg };
    case "memo":
      return { ...base, "@odata.type": T("MemoAttributeMetadata"), MaxLength: 1048576, Format: "TextArea" };
    case "int":
      return { ...base, "@odata.type": T("IntegerAttributeMetadata"), Format: "None", MinValue: -2147483648, MaxValue: 2147483647 };
    case "bigint":
      return { ...base, "@odata.type": T("BigIntAttributeMetadata") };
    case "decimal":
      return { ...base, "@odata.type": T("DecimalAttributeMetadata"), Precision: 4, MinValue: -100000000000, MaxValue: 100000000000 };
    case "money":
      return { ...base, "@odata.type": T("MoneyAttributeMetadata"), PrecisionSource: 2 };
    case "bool":
      return {
        ...base,
        "@odata.type": T("BooleanAttributeMetadata"),
        DefaultValue: false,
        OptionSet: { TrueOption: { Value: 1, Label: label("Yes") }, FalseOption: { Value: 0, Label: label("No") } },
      };
    case "datetime":
      return { ...base, "@odata.type": T("DateTimeAttributeMetadata"), Format: "DateAndTime", DateTimeBehavior: { Value: "UserLocal" } };
    case "date":
      return { ...base, "@odata.type": T("DateTimeAttributeMetadata"), Format: "DateOnly", DateTimeBehavior: { Value: "DateOnly" } };
    case "choice":
      return { ...base, "@odata.type": T("PicklistAttributeMetadata"), "GlobalOptionSet@odata.bind": `/GlobalOptionSetDefinitions(${choiceIds[arg]})` };
    case "file":
      return { ...base, "@odata.type": T("FileAttributeMetadata"), MaxSizeInKB: 32768 };
    default:
      throw new Error(`${table.name}.${name}: unknown type ${type}`);
  }
}

function lookupPayload(table, [name, type, required, note]) {
  const target = type.split(":")[1];
  return {
    "@odata.type": T("OneToManyRelationshipMetadata"),
    SchemaName: `${P}_${table.name}_${name}`,
    ReferencedEntity: ln(target),
    ReferencingEntity: ln(table.name),
    // Requirements 10.2: closing a parent must never delete history.
    CascadeConfiguration: { Assign: "NoCascade", Delete: required ? "Restrict" : "RemoveLink", Merge: "NoCascade", Reparent: "NoCascade", Share: "NoCascade", Unshare: "NoCascade" },
    Lookup: {
      "@odata.type": T("LookupAttributeMetadata"),
      SchemaName: `${P}_${name}`,
      DisplayName: label(titleCase(name)),
      Description: label(note || ""),
      RequiredLevel: { Value: required ? "ApplicationRequired" : "None" },
      IsAuditEnabled: { Value: true },
    },
  };
}

// ---- run --------------------------------------------------------------------

// --verify: read-only check that everything in schema.json exists.
async function verify() {
  token = await getToken();
  const missing = [];
  let checked = 0;
  const need = async (what, path) => {
    checked++;
    if (!(await exists(path))) missing.push(what);
  };
  for (const name of Object.keys(schema.choices)) await need(`choice ${name}`, `GlobalOptionSetDefinitions(Name='${P}_${name}')?$select=MetadataId`);
  for (const t of schema.tables) {
    const e = `EntityDefinitions(LogicalName='${ln(t.name)}')`;
    const attrs = await api("GET", `${e}/Attributes?$select=LogicalName`);
    const keys = await api("GET", `${e}/Keys?$select=LogicalName`);
    checked++;
    if (!attrs) {
      missing.push(`table ${t.name}`);
      continue;
    }
    const have = new Set(attrs.value.map((a) => a.LogicalName));
    for (const c of t.columns) {
      checked++;
      if (!have.has(`${P}_${c[0]}`)) missing.push(`column ${t.name}.${c[0]}`);
    }
    const haveKeys = new Set((keys?.value ?? []).map((k) => k.LogicalName));
    for (const key of t.keys ?? []) {
      checked++;
      if (!haveKeys.has(`${P}_${t.name}_${key.join("_")}`.slice(0, 90))) missing.push(`key ${t.name}(${key.join(",")})`);
    }
  }
  console.log(`Checked ${checked} items; ${missing.length} missing.`);
  for (const m of missing) console.log(`  missing: ${m}`);
  const keyState = await api("GET", `EntityKeyMetadata?$select=LogicalName,EntityKeyIndexStatus`).catch(() => null);
  if (keyState?.value) {
    const mine = keyState.value.filter((k) => k.LogicalName?.startsWith(`${P}_`));
    const by = {};
    for (const k of mine) by[k.EntityKeyIndexStatus] = (by[k.EntityKeyIndexStatus] ?? 0) + 1;
    console.log("Key index status:", JSON.stringify(by));
  }
}

async function main() {
  if (flag("--verify")) return verify();
  if (!dryRun) token = await getToken();

  step("Publisher and solution");
  let publisherId = dryRun ? "00000000-0000-0000-0000-000000000000" : undefined;
  const pub = await api("GET", `publishers?$select=publisherid&$filter=customizationprefix eq '${P}'`);
  if (pub?.value?.length) publisherId = pub.value[0].publisherid;
  else {
    await api("POST", "publishers", { uniquename: P, friendlyname: "NBPRA", customizationprefix: P, customizationoptionvalueprefix: OPTION_PREFIX }, { solution: false });
    if (!dryRun) publisherId = (await api("GET", `publishers?$select=publisherid&$filter=customizationprefix eq '${P}'`)).value[0].publisherid;
  }
  const sol = await api("GET", `solutions?$select=solutionid&$filter=uniquename eq '${schema.solution}'`);
  if (!sol?.value?.length) {
    await api("POST", "solutions", { uniquename: schema.solution, friendlyname: "NBPRA", version: "0.1.0.0", "publisherid@odata.bind": `/publishers(${publisherId})` }, { solution: false });
  }

  step(`Choices (${Object.keys(schema.choices).length})`);
  for (const [name, options] of Object.entries(schema.choices)) {
    if (await exists(`GlobalOptionSetDefinitions(Name='${P}_${name}')`)) continue;
    await api("POST", "GlobalOptionSetDefinitions", {
      "@odata.type": T("OptionSetMetadata"),
      Name: `${P}_${name}`,
      DisplayName: label(titleCase(name)),
      IsGlobal: true,
      OptionSetType: "Picklist",
      Options: options.map((o, i) => ({ Value: OPTION_PREFIX * 10000 + i, Label: label(o) })),
    });
  }

  for (const name of Object.keys(schema.choices)) {
    const o = await api("GET", `GlobalOptionSetDefinitions(Name='${P}_${name}')?$select=MetadataId`);
    choiceIds[name] = o?.MetadataId ?? "00000000-0000-0000-0000-000000000000";
  }

  step(`Tables (${schema.tables.length})`);
  for (const t of schema.tables) {
    if (await exists(`EntityDefinitions(LogicalName='${ln(t.name)}')`)) continue;
    await api("POST", "EntityDefinitions", {
      "@odata.type": T("EntityMetadata"),
      SchemaName: ln(t.name),
      DisplayName: label(t.display),
      DisplayCollectionName: label(`${t.display}s`),
      Description: label(t.note ?? ""),
      OwnershipType: t.ownership === "user" ? "UserOwned" : "OrganizationOwned",
      HasActivities: false,
      HasNotes: false,
      IsAuditEnabled: { Value: true },
      Attributes: [
        {
          "@odata.type": T("StringAttributeMetadata"),
          SchemaName: `${P}_name`,
          IsPrimaryName: true,
          MaxLength: 200,
          FormatName: { Value: "Text" },
          RequiredLevel: { Value: "None" },
          DisplayName: label("Name"),
        },
      ],
    });
  }

  step("Columns");
  for (const t of schema.tables) {
    for (const c of t.columns.filter((c) => !c[1].startsWith("lookup:"))) {
      if (await exists(`EntityDefinitions(LogicalName='${ln(t.name)}')/Attributes(LogicalName='${P}_${c[0]}')`)) continue;
      await api("POST", `EntityDefinitions(LogicalName='${ln(t.name)}')/Attributes`, columnPayload(t, c));
    }
  }

  step("Lookups");
  for (const t of schema.tables) {
    for (const c of t.columns.filter((c) => c[1].startsWith("lookup:"))) {
      if (await exists(`RelationshipDefinitions(SchemaName='${P}_${t.name}_${c[0]}')`)) continue;
      await api("POST", "RelationshipDefinitions", lookupPayload(t, c));
    }
  }

  step("Alternate keys");
  for (const t of schema.tables) {
    for (const key of t.keys ?? []) {
      const keyName = `${P}_${t.name}_${key.join("_")}`.slice(0, 90);
      if (await exists(`EntityDefinitions(LogicalName='${ln(t.name)}')/Keys(LogicalName='${keyName}')`)) continue;
      await api("POST", `EntityDefinitions(LogicalName='${ln(t.name)}')/Keys`, {
        SchemaName: keyName,
        DisplayName: label(key.map(titleCase).join(" + ")),
        KeyAttributes: key.map((k) => `${P}_${k}`),
      });
    }
  }

  if (dryRun) {
    writeFileSync(join(here, "plan.json"), JSON.stringify(plan, null, 2));
    const count = (re) => plan.filter((p) => re.test(p.path)).length;
    console.log(
      `Dry run: ${plan.length} requests written to plan.json ` +
        `(${count(/^GlobalOptionSet/)} choices, ${count(/^EntityDefinitions$/)} tables, ${count(/\/Attributes$/)} columns, ${count(/^RelationshipDefinitions$/)} lookups, ${count(/\/Keys$/)} keys)`,
    );
  } else {
    await api("POST", "PublishAllXml", {}, { solution: false });
    console.log("Done and published.");
  }
}

// Every step checks for existence first, so after a dropped connection or a
// throttling response the whole run is simply started again.
for (let attempt = 1; ; attempt++) {
  try {
    await main();
    break;
  } catch (e) {
    const transient = e.message === "fetch failed" || / -> (429|502|503|504)\n/.test(e.message);
    console.error(e.message, e.cause?.message ?? "");
    if (!transient || attempt >= 10) process.exit(1);
    console.error(`Transient failure; restarting (attempt ${attempt + 1})`);
    await new Promise((r) => setTimeout(r, 5000 * attempt));
  }
}
