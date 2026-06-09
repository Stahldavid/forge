// @forge-generated generator=0.0.0 input=8b9e3eedfc9e18645d0c38411668351c9b3b29c7026fb99dd849e9a95904f4cb content=73c83927a61fb2c53e21de95e2f89b9308d07c501e6a9c35522864350c8be2db
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
      "file": "src/workflows/triageTicketWorkflow.ts",
      "effectiveContexts": [
        "workflow"
      ]
    }
  ]
} as const;
