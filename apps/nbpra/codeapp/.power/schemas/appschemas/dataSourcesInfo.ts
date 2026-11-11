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
  "nbpra_businessevents": {
    "tableId": "",
    "version": "",
    "primaryKey": "nbpra_businesseventid",
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
  "systemusers": {
    "tableId": "",
    "version": "",
    "primaryKey": "systemuserid",
    "dataSourceType": "Dataverse",
    "apis": {}
  }
};
