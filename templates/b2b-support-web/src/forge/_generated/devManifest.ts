// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=492fbb2db28dd1bfb125bdef5e39674eff3a7cb090925f2186c9287fd2a95ffc
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [
    {
      "invokePath": "/run/captureTicketCreated",
      "kind": "action",
      "name": "captureTicketCreated",
      "semanticPath": "/actions/captureTicketCreated"
    },
    {
      "invokePath": "/run/closeTicket",
      "kind": "command",
      "name": "closeTicket",
      "semanticPath": "/commands/closeTicket"
    },
    {
      "invokePath": "/run/createTicket",
      "kind": "command",
      "name": "createTicket",
      "semanticPath": "/commands/createTicket"
    },
    {
      "invokePath": "/queries/getTicket",
      "kind": "query",
      "name": "getTicket",
      "semanticPath": "/queries/getTicket"
    },
    {
      "invokePath": "/queries/listTickets",
      "kind": "query",
      "name": "listTickets",
      "semanticPath": "/queries/listTickets"
    },
    {
      "invokePath": "/run/manageBilling",
      "kind": "command",
      "name": "manageBilling",
      "semanticPath": "/commands/manageBilling"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "ae47e26ed8201661c9f804d6f1e939a45c76b5bf29dfd6ecc3f45b33cd9f2ce2",
  "routes": [
    {
      "entryKind": "action",
      "entryName": "captureTicketCreated",
      "method": "POST",
      "path": "/actions/captureTicketCreated",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "closeTicket",
      "method": "POST",
      "path": "/commands/closeTicket",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "createTicket",
      "method": "POST",
      "path": "/commands/createTicket",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "manageBilling",
      "method": "POST",
      "path": "/commands/manageBilling",
      "purpose": "invoke"
    },
    {
      "method": "GET",
      "path": "/entries",
      "purpose": "entries"
    },
    {
      "method": "GET",
      "path": "/health",
      "purpose": "health"
    },
    {
      "method": "GET",
      "path": "/queries",
      "purpose": "queries"
    },
    {
      "entryKind": "query",
      "entryName": "getTicket",
      "method": "POST",
      "path": "/queries/getTicket",
      "purpose": "query"
    },
    {
      "entryKind": "query",
      "entryName": "listTickets",
      "method": "POST",
      "path": "/queries/listTickets",
      "purpose": "query"
    },
    {
      "entryKind": "action",
      "entryName": "captureTicketCreated",
      "method": "POST",
      "path": "/run/captureTicketCreated",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "closeTicket",
      "method": "POST",
      "path": "/run/closeTicket",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "createTicket",
      "method": "POST",
      "path": "/run/createTicket",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "manageBilling",
      "method": "POST",
      "path": "/run/manageBilling",
      "purpose": "invoke"
    },
    {
      "method": "GET",
      "path": "/workflows",
      "purpose": "workflows"
    },
    {
      "method": "POST",
      "path": "/workflows/process",
      "purpose": "workflow-process"
    },
    {
      "method": "GET",
      "path": "/workflows/runs",
      "purpose": "workflow-runs"
    }
  ],
  "schemaVersion": "1.0.0",
  "workflows": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "name": "triageTicketWorkflow"
    }
  ]
} as const;
