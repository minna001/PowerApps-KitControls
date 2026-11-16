#!/usr/bin/env node
// Creates the cloud flow that asks a signatory for approval, with its two
// connection references, inside the NBPRA solution. Safe to re-run.
//
//   node flows.mjs --url https://<org>.crm.dynamics.com
//
// The flow is created switched off. Someone has to open it once in Power
// Automate, sign in the two connections (Dataverse and Approvals) and turn it
// on; connections cannot be created from a script. The account behind the
// Dataverse connection needs the NBPRA Automation or NBPRA Administrator role.
//
// What it does: when a signatory row becomes Pending (the app's "Send for
// approval"), it sends that person an approval in Outlook and Teams, waits for
// the answer, and reports it to the nbpra_Workflow operation decideSignatory.
// The server checks the responder is the named signatory before recording it.
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
const PENDING = 774100000 + schema.choices.signatorystatus.indexOf("Pending");

const DATAVERSE = "shared_commondataserviceforapps";
const APPROVALS = "shared_approvals";
const apiId = (name) => `/providers/Microsoft.PowerApps/apis/${name}`;

console.log("Connection references");
const REFS = [
  [`${P}_dataverse`, "NBPRA Dataverse", DATAVERSE],
  [`${P}_approvals`, "NBPRA Approvals", APPROVALS],
];
for (const [logical, display, connector] of REFS) {
  const have = (await api("GET", `connectionreferences?$select=connectionreferenceid&$filter=connectionreferencelogicalname eq '${logical}'`)).value[0];
  if (!have) await api("POST", "connectionreferences", { connectionreferencelogicalname: logical, connectionreferencedisplayname: display, connectorid: apiId(connector) });
  console.log(`  ${logical}${have ? " (exists)" : ""}`);
}

const host = (connectionName, operationId) => ({ connectionName, operationId, apiId: apiId(connectionName) });
const auth = "@parameters('$authentication')";
const seat = (column) => `triggerOutputs()?['body/${P}_${column}']`;
const answer = "outputs('Ask_the_signatory')?['body/outcome']";
const response = "first(outputs('Ask_the_signatory')?['body/responses'])";

const definition = {
  $schema: "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
  contentVersion: "1.0.0.0",
  parameters: {
    $connections: { defaultValue: {}, type: "Object" },
    $authentication: { defaultValue: {}, type: "SecureObject" },
  },
  triggers: {
    When_a_signatory_is_asked: {
      type: "OpenApiConnectionWebhook",
      inputs: {
        host: host(DATAVERSE, "SubscribeWebhookTrigger"),
        parameters: {
          "subscriptionRequest/message": 4, // added or modified
          "subscriptionRequest/entityname": `${P}_signatory`,
          "subscriptionRequest/scope": 4, // organization
          "subscriptionRequest/filteringattributes": `${P}_status`,
          "subscriptionRequest/filterexpression": `${P}_status eq ${PENDING} and ${P}_iscurrent eq true`,
        },
        authentication: auth,
      },
    },
  },
  actions: {
    Get_the_submission: {
      type: "OpenApiConnection",
      runAfter: {},
      inputs: {
        host: host(DATAVERSE, "GetItem"),
        parameters: {
          entityName: `${P}_submissions`,
          recordId: `@triggerOutputs()?['body/_${P}_submission_value']`,
          $select: `${P}_reference,${P}_name,${P}_summary`,
        },
        authentication: auth,
      },
    },
    Ask_the_signatory: {
      type: "OpenApiConnectionWebhook",
      runAfter: { Get_the_submission: ["Succeeded"] },
      inputs: {
        host: host(APPROVALS, "StartAndWaitForAnApproval"),
        parameters: {
          approvalType: "Basic",
          "WebhookApprovalCreationInput/title": `@concat('NBPRA approval: ', outputs('Get_the_submission')?['body/${P}_name'], ' (', outputs('Get_the_submission')?['body/${P}_reference'], ')')`,
          "WebhookApprovalCreationInput/assignedTo": `@${seat("email")}`,
          "WebhookApprovalCreationInput/details": `@concat('You are asked to approve this proposal as a signatory', if(empty(${seat("role")}), '', concat(' for ', ${seat("role")})), '.', decodeUriComponent('%0A%0A'), '**Proposal:** ', outputs('Get_the_submission')?['body/${P}_name'], decodeUriComponent('%0A%0A'), coalesce(outputs('Get_the_submission')?['body/${P}_summary'], ''), decodeUriComponent('%0A%0A'), 'Approve to sign. Reject to return the package to the business owner; a comment is required when rejecting.')`,
          "WebhookApprovalCreationInput/enableNotifications": true,
          "WebhookApprovalCreationInput/enableReassignment": false,
        },
        authentication: auth,
      },
    },
    Report_the_answer: {
      type: "OpenApiConnection",
      runAfter: { Ask_the_signatory: ["Succeeded"] },
      inputs: {
        host: host(DATAVERSE, "PerformUnboundAction"),
        parameters: {
          actionName: `${P}_Workflow`,
          "item/Operation": "decideSignatory",
          "item/TargetId": `@${seat("signatoryid")}`,
          "item/Outcome": `@if(equals(${answer}, 'Approve'), 'approve', 'return')`,
          "item/Comment": `@if(empty(${response}?['comments']), if(equals(${answer}, 'Approve'), '', 'Rejected without a comment.'), ${response}?['comments'])`,
          "item/Payload": `@concat('{"responder":"', ${response}?['responder']?['email'], '"}')`,
        },
        authentication: auth,
      },
    },
  },
};

const clientdata = JSON.stringify({
  properties: {
    connectionReferences: Object.fromEntries(
      REFS.map(([logical, , connector]) => [connector, { runtimeSource: "embedded", connection: { connectionReferenceLogicalName: logical }, api: { name: connector } }]),
    ),
    definition,
  },
  schemaVersion: "1.0.0.0",
});

console.log("Cloud flow");
const NAME = "NBPRA signatory approval";
const description = "Sends a signatory their approval request when the submitter asks, and records the answer on the submission.";
const existing = (await api("GET", `workflows?$select=workflowid,statecode&$filter=category eq 5 and name eq '${NAME}'`)).value[0];
if (existing) {
  await api("PATCH", `workflows(${existing.workflowid})`, { clientdata, description });
  console.log(`  updated (${existing.statecode === 1 ? "on" : "off"})`);
} else {
  await api("POST", "workflows", { category: 5, name: NAME, type: 1, primaryentity: "none", description, clientdata });
  console.log("  created, switched off");
}
console.log("Open the flow in Power Automate, sign in its two connections and turn it on.");
