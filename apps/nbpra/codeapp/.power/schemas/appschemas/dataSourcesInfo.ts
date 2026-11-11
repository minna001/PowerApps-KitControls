/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export const dataSourcesInfo = {
  "nbpra_admindecision": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "nbpra_AdminDecision": {
        "path": "/api/data/v9.2/nbpra_AdminDecision",
        "method": "POST",
        "parameters": [
          {
            "name": "SubmissionId",
            "in": "body",
            "required": true,
            "type": "string"
          },
          {
            "name": "Action",
            "in": "body",
            "required": true,
            "type": "string"
          },
          {
            "name": "Comment",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "Channel",
            "in": "body",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "nbpra_answers": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_answerid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_approvalassignments": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_approvalassignmentid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_approvaldecisions": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_approvaldecisionid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_approvalrequests": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_approvalrequestid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_businessevents": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_businesseventid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_committees": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_committeeid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_meetings": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_meetingid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_questiondefs": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_questiondefid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_questionoptions": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_questionoptionid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_sectiondefs": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_sectiondefid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_sectioninstances": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_sectioninstanceid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_sectionrevisions": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_sectionrevisionid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_signatories": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_signatoryid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_slotrequests": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_slotrequestid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_slots": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_slotid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_submissions": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_submissionid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "nbpra_workflow": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Dataverse",
    "apis": {
      "nbpra_Workflow": {
        "path": "/api/data/v9.2/nbpra_Workflow",
        "method": "POST",
        "parameters": [
          {
            "name": "Operation",
            "in": "body",
            "required": true,
            "type": "string"
          },
          {
            "name": "TargetId",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "Outcome",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "Comment",
            "in": "body",
            "required": false,
            "type": "string"
          },
          {
            "name": "Payload",
            "in": "body",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "systemusers": {
    "tableId": "",
    "version": "",
    "primaryKey": "systemuserid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "teams": {
    "tableId": "",
    "version": "",
    "primaryKey": "teamid",
    "dataSourceType": "Dataverse",
    "apis": {}
  }
};
