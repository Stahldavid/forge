// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=e1dcb050832df877b8d36db90321be887ba1b2670cf59c62d99c9de33be56602
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
  "inputHash": "2d0006065bf80c6575fe5fe825053df2d5461cda6d02748a657e2322b5402f28",
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
