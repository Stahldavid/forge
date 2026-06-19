// @forge-generated generator=0.1.0-alpha.16 input=8eb999ad15dd5d4ef04649d90d87e1c5fb395bbd74791852afd75ad6a5dfbe13 content=ad7ecb223cb611bfbf7d20074dfbd842c862146bfdb7e34494f1d57faf66623f
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
      "packageName": "@changesets/changelog-github",
      "alias": "@changesets/changelog-github",
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
      "packageName": "@changesets/cli",
      "alias": "@changesets/cli",
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
      "packageName": "@types/node",
      "alias": "@types/node",
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
      "packageName": "jose",
      "alias": "jose",
      "compatible": [
        "client",
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
        "query",
        "liveQuery",
        "command"
      ],
      "rationale": {
        "shared": "shared context requires pure code without network/fs/process",
        "client": "client may perform network egress",
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
      "packageName": "postgres",
      "alias": "postgres",
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
      "packageName": "tsx",
      "alias": "tsx",
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
      "packageName": "vue",
      "alias": "vue",
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
