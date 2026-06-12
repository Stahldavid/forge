// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=6354172a6ec8ecdf6048e18456e055d8aaf2617f69dc421fbfcdb1dcc3f53c74
export const capabilityMap = {
  "diagnostics": [],
  "entries": [
    {
      "id": "runtime:command:badStripeCommand",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [],
        "emits": [],
        "hook": "useCommand(api.commands.badStripeCommand)",
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/badStripeCommand"
        },
        "kind": "command",
        "name": "badStripeCommand",
        "policy": "public",
        "tablesRead": [],
        "tablesWritten": []
      },
      "status": "backend-only",
      "userAction": "Call command badStripeCommand"
    },
    {
      "id": "runtime:command:createTicket",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [],
        "emits": [
          "ticket.created"
        ],
        "hook": "useCommand(api.commands.createTicket)",
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/createTicket"
        },
        "kind": "command",
        "name": "createTicket",
        "policy": "tickets.create",
        "tablesRead": [],
        "tablesWritten": [
          "tickets"
        ]
      },
      "status": "backend-only",
      "userAction": "Call command createTicket"
    },
    {
      "id": "runtime:command:manageBilling",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [],
        "emits": [],
        "hook": "useCommand(api.commands.manageBilling)",
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/commands/manageBilling"
        },
        "kind": "command",
        "name": "manageBilling",
        "policy": "billing.manage",
        "tablesRead": [],
        "tablesWritten": []
      },
      "status": "backend-only",
      "userAction": "Call command manageBilling"
    },
    {
      "id": "runtime:liveQuery:liveTickets",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [
          {
            "scope": "tenant",
            "table": "tickets"
          }
        ],
        "emits": [],
        "hook": "useLiveQuery(api.liveQueries.liveTickets, args)",
        "http": {
          "exampleUrl": "/live/liveTickets?args={}",
          "method": "GET",
          "path": "/live/liveTickets"
        },
        "kind": "liveQuery",
        "name": "liveTickets",
        "policy": "tickets.read",
        "tablesRead": [
          "tickets"
        ],
        "tablesWritten": []
      },
      "status": "backend-only",
      "userAction": "Subscribe to liveQuery liveTickets"
    },
    {
      "id": "runtime:query:getTicket",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [],
        "emits": [],
        "hook": "useQuery(api.queries.getTicket, args)",
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/queries/getTicket"
        },
        "kind": "query",
        "name": "getTicket",
        "policy": "tickets.read",
        "tablesRead": [
          "tickets"
        ],
        "tablesWritten": []
      },
      "status": "backend-only",
      "userAction": "Read query getTicket"
    },
    {
      "id": "runtime:query:listTickets",
      "notes": [
        "Runtime entry is available to agents even though no frontend usage was detected."
      ],
      "runtime": {
        "dependencies": [],
        "emits": [],
        "hook": "useQuery(api.queries.listTickets, args)",
        "http": {
          "exampleBody": {
            "args": {}
          },
          "method": "POST",
          "path": "/queries/listTickets"
        },
        "kind": "query",
        "name": "listTickets",
        "policy": "tickets.read",
        "tablesRead": [
          "tickets"
        ],
        "tablesWritten": []
      },
      "status": "backend-only",
      "userAction": "Read query listTickets"
    }
  ],
  "generatorVersion": "0.0.0",
  "project": {
    "name": "basic-forge-app",
    "type": "forgeos-app"
  },
  "schemaVersion": "0.1.0",
  "summary": {
    "backendOnly": 6,
    "covered": 0,
    "frontendOnly": 0,
    "warnings": 0
  }
} as const;
