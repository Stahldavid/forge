// @forge-generated generator=0.0.0 input=3dca8512d9791aca68400cfc59bb3ddc0654faa8040d530afba050fc105a74dc content=ff2e8b763079c41c1b07c517c14dfffed8230fcfa8bd9b69f5c6dbdd1902befe
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
      "packageName": "@types/react",
      "alias": "@types/react",
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
      "packageName": "@types/react-test-renderer",
      "alias": "@types/react-test-renderer",
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
      "packageName": "react",
      "alias": "react",
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
      "packageName": "react-test-renderer",
      "alias": "react-test-renderer",
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
