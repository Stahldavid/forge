// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=8081aa68a79fbaf06900f3c85ea24d76892ae2a76e014066635ef13f60283620
export const importGuards = {
  "schemaVersion": "1",
  "entries": [
    {
      "packageName": "posthog-js",
      "alias": "posthog",
      "compatible": [
        "shared",
        "client",
        "test",
        "build"
      ],
      "incompatible": [
        "server",
        "query",
        "liveQuery",
        "command",
        "action",
        "workflow",
        "endpoint",
        "edge"
      ],
      "rationale": {
        "shared": "allowed by integration recipe",
        "client": "allowed by integration recipe",
        "server": "denied by integration recipe",
        "query": "denied by integration recipe",
        "liveQuery": "denied by integration recipe",
        "command": "denied by integration recipe",
        "action": "denied by integration recipe",
        "workflow": "denied by integration recipe",
        "endpoint": "denied by integration recipe",
        "edge": "denied by integration recipe",
        "test": "allowed by integration recipe",
        "build": "allowed by integration recipe"
      }
    },
    {
      "packageName": "posthog-node",
      "alias": "posthog",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "rationale": {
        "shared": "denied by integration recipe",
        "client": "denied by integration recipe",
        "server": "allowed by integration recipe",
        "query": "denied by integration recipe",
        "liveQuery": "denied by integration recipe",
        "command": "denied by integration recipe",
        "action": "allowed by integration recipe",
        "workflow": "allowed by integration recipe",
        "endpoint": "allowed by integration recipe",
        "edge": "not in integration recipe allowed contexts",
        "test": "not in integration recipe allowed contexts",
        "build": "not in integration recipe allowed contexts"
      }
    },
    {
      "packageName": "stripe",
      "alias": "stripe",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge",
        "test",
        "build"
      ],
      "rationale": {
        "shared": "denied by integration recipe",
        "client": "denied by integration recipe",
        "server": "allowed by integration recipe",
        "query": "denied by integration recipe",
        "liveQuery": "denied by integration recipe",
        "command": "denied by integration recipe",
        "action": "allowed by integration recipe",
        "workflow": "allowed by integration recipe",
        "endpoint": "allowed by integration recipe",
        "edge": "not in integration recipe allowed contexts",
        "test": "not in integration recipe allowed contexts",
        "build": "not in integration recipe allowed contexts"
      }
    },
    {
      "packageName": "zod",
      "alias": "zod",
      "compatible": [
        "shared",
        "client",
        "server",
        "query",
        "liveQuery",
        "command",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [],
      "rationale": {
        "shared": "allowed by integration recipe",
        "client": "allowed by integration recipe",
        "server": "allowed by integration recipe",
        "query": "allowed by integration recipe",
        "liveQuery": "allowed by integration recipe",
        "command": "allowed by integration recipe",
        "action": "allowed by integration recipe",
        "workflow": "allowed by integration recipe",
        "endpoint": "allowed by integration recipe",
        "edge": "allowed by integration recipe",
        "test": "allowed by integration recipe",
        "build": "allowed by integration recipe"
      }
    }
  ],
  "moduleContexts": [
    {
      "file": "src/actions/capturePosthog.ts",
      "effectiveContexts": [
        "action"
      ]
    },
    {
      "file": "src/actions/captureTicketCreated.ts",
      "effectiveContexts": [
        "action"
      ]
    },
    {
      "file": "src/actions/createCheckout.ts",
      "effectiveContexts": [
        "action"
      ]
    },
    {
      "file": "src/commands/badStripeCommand.ts",
      "effectiveContexts": [
        "command"
      ]
    },
    {
      "file": "src/commands/createTicket.ts",
      "effectiveContexts": [
        "command"
      ]
    },
    {
      "file": "src/commands/manageBilling.ts",
      "effectiveContexts": [
        "command"
      ]
    },
    {
      "file": "src/lib/posthogServer.ts",
      "effectiveContexts": [
        "action"
      ]
    },
    {
      "file": "src/lib/stripeClient.ts",
      "effectiveContexts": [
        "action",
        "command"
      ]
    },
    {
      "file": "src/queries/getTicket.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/queries/listTickets.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/queries/liveTickets.ts",
      "effectiveContexts": [
        "liveQuery"
      ]
    },
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "effectiveContexts": [
        "workflow"
      ]
    }
  ]
} as const;
