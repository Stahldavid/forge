// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=706f186c8fa8eedb1a379e522d5e9fc455aecc2c2e335b77b1d3b94d18f47a83
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
      "file": "src/workflows/triageTicketWorkflow.ts",
      "effectiveContexts": [
        "workflow"
      ]
    }
  ]
} as const;
