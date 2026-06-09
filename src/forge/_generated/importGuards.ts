// @forge-generated generator=0.0.0 input=a364a2ec435f1ad252c1d418c40d3d787ffd94db8ab078dc670d129e1ab2d4fd content=7c551d5d529f924c4a55f00aa3332f56f82db68cba7c95154ef360629f5c9777
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
  "moduleContexts": [
    {
      "file": "src/forge/compiler/app-graph/build.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/classify.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/dup-symbol.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/extract.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/forge-apis.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/module-graph.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/parser.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/symbols.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/tsconfig-hash.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/app-graph/versions.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/cache/key.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/cache/scheduler.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/cache/store.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/capabilities.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/classify.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/contexts.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/runtime-matrix.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/secrets.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/classifier/signals.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/data-graph/sql/serialize.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/data-graph/sql/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/diagnostics/codes.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/diagnostics/create.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/emitter/constants.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/guards/check-import-guards.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/guards/propagate-contexts.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/orchestrator/discover.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/orchestrator/manifest.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/orchestrator/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/capabilities-stub.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/checksum.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/compiler.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/constants.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/exports-discovery.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/extract-dts.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/jsdoc.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/read-file.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-graph/resolve.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/package-manager/detect.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/compare.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/hash.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/header.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/paths.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/serialize.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/primitives/sort.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/recipes/definitions.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/recipes/helpers.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/recipes/registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/sandbox/index.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/action-subscriptions.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/ai-registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/app-graph.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/capability.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/classification.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/dev-manifest.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/diagnostic.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/emit.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/integration.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/json.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/lock.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/package-graph.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/policy-registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/runtime-graph.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/runtime-matrix.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/runtime.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/sandbox.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/secret-registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/compiler/types/workflow-registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/dev/server.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/dev/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/check.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/context.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/cost-estimator.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/mock.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/providers.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/state.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/ai/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/auth/evaluate.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/auth/resolve.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/auth/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/context/create-context.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/adapter.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/factory.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/generated-client.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/memory-adapter.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/migrate.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/outbox.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/pglite-adapter.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/db/postgres-adapter.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/executor.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/outbox/claim.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/outbox/process.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/outbox/retry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/outbox/subscriptions.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/outbox/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/policy/check.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/policy/load.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/runner/command-transaction.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/runner/run-entry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/secrets/check.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/secrets/create-context.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/secrets/env-loader.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/secrets/runtime-bundle.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/secrets/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/buffer.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/context.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/correlation.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/flush.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/process.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/scrubber.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/sinks/local-jsonl.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/sinks/posthog.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/sinks/sentry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/spans.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/telemetry/types.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/cancel.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/create-run.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/process-run.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/process-step.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/process.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/registry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/resolve-step.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/retry-run.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/retry.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/sanitize.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/start-from-outbox.ts",
      "effectiveContexts": [
        "query"
      ]
    },
    {
      "file": "src/forge/runtime/workflows/types.ts",
      "effectiveContexts": [
        "query"
      ]
    }
  ]
} as const;
