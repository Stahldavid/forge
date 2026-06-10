// @forge-generated generator=0.0.0 input=dbed69e6d72dbc70c4da980e189c370546d6773f069f0b210a3b192dab421887 content=dc6ee2bc58d6c51717627bec9fc009434b9571985decd78806a33167af979d5f
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [
    {
      "invokePath": "/run/badStripeCommand",
      "kind": "command",
      "name": "badStripeCommand",
      "semanticPath": "/commands/badStripeCommand"
    },
    {
      "invokePath": "/run/capturePosthog",
      "kind": "action",
      "name": "capturePosthog",
      "semanticPath": "/actions/capturePosthog"
    },
    {
      "invokePath": "/run/captureTicketCreated",
      "kind": "action",
      "name": "captureTicketCreated",
      "semanticPath": "/actions/captureTicketCreated"
    },
    {
      "invokePath": "/run/createCheckout",
      "kind": "action",
      "name": "createCheckout",
      "semanticPath": "/actions/createCheckout"
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
  "inputHash": "deb5642f1547e3b3a7dc10340ea6114a702a41e05c31d6d1a16dc067b6c4f925",
  "routes": [
    {
      "entryKind": "action",
      "entryName": "capturePosthog",
      "method": "POST",
      "path": "/actions/capturePosthog",
      "purpose": "invoke"
    },
    {
      "entryKind": "action",
      "entryName": "captureTicketCreated",
      "method": "POST",
      "path": "/actions/captureTicketCreated",
      "purpose": "invoke"
    },
    {
      "entryKind": "action",
      "entryName": "createCheckout",
      "method": "POST",
      "path": "/actions/createCheckout",
      "purpose": "invoke"
    },
    {
      "entryKind": "command",
      "entryName": "badStripeCommand",
      "method": "POST",
      "path": "/commands/badStripeCommand",
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
      "entryKind": "command",
      "entryName": "badStripeCommand",
      "method": "POST",
      "path": "/run/badStripeCommand",
      "purpose": "invoke"
    },
    {
      "entryKind": "action",
      "entryName": "capturePosthog",
      "method": "POST",
      "path": "/run/capturePosthog",
      "purpose": "invoke"
    },
    {
      "entryKind": "action",
      "entryName": "captureTicketCreated",
      "method": "POST",
      "path": "/run/captureTicketCreated",
      "purpose": "invoke"
    },
    {
      "entryKind": "action",
      "entryName": "createCheckout",
      "method": "POST",
      "path": "/run/createCheckout",
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
