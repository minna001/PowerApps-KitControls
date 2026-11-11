#!/usr/bin/env node
// Uploads the single-file build of the React app as the web resource
// nbpra_/app.html. Build first: (cd ../codeapp && npm run build:webresource).
// Then run mda.mjs so the site map shows it as "Workspace".
//
//   node webapp.mjs --url https://<org>.crm.dynamics.com
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
const { api, url } = connect(urlArg, schema.solution);
const NAME = `${schema.publisherPrefix}_/app.html`;
const file = readFileSync(join(here, "../codeapp/dist-webresource/index.html"));
const content = file.toString("base64");

let id = (await api("GET", `webresourceset?$select=webresourceid&$filter=name eq '${NAME}'`)).value[0]?.webresourceid;
if (id) await api("PATCH", `webresourceset(${id})`, { content });
else id = (await api("POST", "webresourceset", { name: NAME, displayname: "NBPRA workspace", webresourcetype: 1, content })).webresourceid;
await api("POST", "PublishXml", { ParameterXml: `<importexportxml><webresources><webresource>${id}</webresource></webresources></importexportxml>` }, { inSolution: false });
console.log(`Uploaded ${NAME} (${Math.round(file.length / 1024)} KB) and published.`);
console.log(`${url}/WebResources/${NAME}`);
