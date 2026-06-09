// @forge-generated generator=0.0.0 input=0a69e6850f3097e39e9eaa2a693231ef9fc44628ac7472c79ce2880db8db5e20 content=23743d87d7975b0122e7e562a3a71481589345981882929d34c80baf97060818
export const importGuards = {
  "schemaVersion": "1",
  "entries": [
    {
      "packageName": "@ai-sdk/anthropic",
      "alias": "ai-provider-anthropic",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
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
        "edge": "denied by integration recipe",
        "test": "allowed by integration recipe",
        "build": "allowed by integration recipe"
      }
    },
    {
      "packageName": "@ai-sdk/openai",
      "alias": "ai-provider-openai",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
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
        "edge": "denied by integration recipe",
        "test": "allowed by integration recipe",
        "build": "allowed by integration recipe"
      }
    },
    {
      "packageName": "@electric-sql/pglite",
      "alias": "@electric-sql/pglite",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "insufficient signals for client compatibility",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
      }
    },
    {
      "packageName": "@types/bun",
      "alias": "@types/bun",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "insufficient signals for client compatibility",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
      }
    },
    {
      "packageName": "ai",
      "alias": "ai-gateway",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command",
        "edge"
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
        "edge": "denied by integration recipe",
        "test": "allowed by integration recipe",
        "build": "allowed by integration recipe"
      }
    },
    {
      "packageName": "fast-check",
      "alias": "fast-check",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "insufficient signals for client compatibility",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
      }
    },
    {
      "packageName": "tree-sitter",
      "alias": "tree-sitter",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "insufficient signals for client compatibility",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
      }
    },
    {
      "packageName": "tree-sitter-typescript",
      "alias": "tree-sitter-typescript",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "insufficient signals for client compatibility",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
      }
    },
    {
      "packageName": "typescript",
      "alias": "typescript",
      "compatible": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "edge",
        "test",
        "build"
      ],
      "incompatible": [
        "shared",
        "client",
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "insufficient signals to prove shared-safe purity",
        "client": "node builtins/process not allowed in client",
        "server": "server-side context allows IO capabilities",
        "query": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "liveQuery": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "command": "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
        "action": "server-side context allows IO capabilities",
        "workflow": "server-side context allows IO capabilities",
        "endpoint": "server-side context allows IO capabilities",
        "edge": "edge-compatible by heuristic",
        "test": "test/build contexts allow broad compatibility",
        "build": "test/build contexts allow broad compatibility"
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
  "moduleContexts": []
} as const;
