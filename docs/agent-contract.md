# Agent Contract

The ForgeOS agent contract is the generated layer that lets AI coding agents understand a project without reading every file.

Important files:

- `AGENTS.md`
- `src/forge/_generated/agentContract.json`
- `src/forge/_generated/agentTools.json`
- `src/forge/_generated/agentTools.md`
- `src/forge/_generated/appMap.md`
- `src/forge/_generated/runtimeRules.md`
- `src/forge/_generated/operationPlaybooks.md`
- `src/forge/_generated/frontendGraph.json`

## What It Contains

The contract includes:

- Commands, queries, liveQueries, actions, and workflows.
- Tables, fields, policies, tenant scope, and RLS metadata.
- Package capabilities and runtime restrictions.
- Dependency API summaries from `PackageGraph`, including selected SDK signatures, docs, examples, and placement hints.
- Secret names, never secret values.
- AI providers, model calls, tools, agents, approval hints, and runtime placement.
- Agent endpoints: `/ai/agents/run` for JSON automation and `/ai/agents/chat` for AI SDK UIMessage streaming.
- Frontend routes, components, providers, bridge files, and client bindings.
- Verification commands and common operation playbooks.

## Example shape

A small contract excerpt looks like this:

```json
{
  "schemaVersion": "0.1.0",
  "project": { "name": "support-app", "type": "forgeos-app" },
  "commands": [
    {
      "name": "createTicket",
      "policy": "tickets.create",
      "tablesWritten": ["tickets"],
      "emits": ["ticket.created"],
      "forbiddenCapabilities": ["network", "secrets", "ai"]
    }
  ],
  "liveQueries": [
    {
      "name": "liveTickets",
      "policy": "tickets.read",
      "dependencies": [{ "table": "tickets", "scope": "tenant" }]
    }
  ],
  "frontend": {
    "routes": ["/tickets"],
    "bindings": ["TicketList -> liveTickets", "CreateTicketForm -> createTicket"]
  },
  "dependencyApis": [
    {
      "package": "stripe",
      "symbol": "checkout.sessions.create",
      "runtimePlacement": ["action", "workflow", "endpoint"]
    }
  ],
  "agentTools": [
    { "name": "forge_query_listTickets", "risk": "read", "needsApproval": false },
    { "name": "forge_command_createTicket", "risk": "write", "needsApproval": true }
  ]
}
```

The real file is larger and deterministic. It includes names, rules, and metadata, never secret values, database rows, or raw prompt payloads.

## Package API evidence

`agentContract.json` also carries dependency API summaries generated from `PackageGraph`. These summaries are intentionally small: they give agents enough evidence to call a package correctly without turning the contract into a copy of `node_modules`.

Use the CLI to refresh or inspect the source evidence:

```bash
forge add stripe --json
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps runtime-compat stripe --json
```

This is the DepLens-inspired part of ForgeOS: agents get resolved exports, signatures, JSDoc, examples when available, trace data, and runtime placement hints before they write code. The same metadata feeds `runtimeMatrix.json` and `importGuards.json`, so package advice is checked later by `forge check`.

## Useful Commands

```bash
forge inspect all --json
forge agent-contract check
forge agent print-context --json
forge inspect agent-tools --json
forge ai tools --json
forge ai agents --json
forge ai trace <traceId> --json
forge inspect frontend --json
forge deps api stripe checkout.sessions.create --json
```

An agent should read `AGENTS.md`, inspect the project, make a targeted change, regenerate, and then verify.

## Export agent adapters

Forge can emit **tool-specific adapter files** derived from the contract (not a second source of truth):

```bash
forge agent export --target generic
forge agent export --target cursor
forge agent export --target codex
forge agent export --target claude
```

| Target | Example outputs |
|--------|-----------------|
| `generic` (default) | `.forge/agent/context.json`, playbooks, done-criteria |
| `cursor` | `.cursor/rules/forge-*.mdc` |
| `codex` | `.codex/skills/forge-*`, agent toml files |
| `claude` | `CLAUDE.md`, `.claude/forge-*.md` |

Adapters are **derived** from:

- `agentContract.json`
- `AGENTS.md`
- `appMap.md`, `runtimeRules.md`, `operationPlaybooks.md`

Do not edit adapter files as the canonical project definition — change source and regenerate:

```bash
forge generate
forge agent export --target cursor
```

Manifest: `src/forge/_generated/agentAdapterManifest.json`

## Related pages

- [AI](ai.md) — generation, agents, tools, and dev endpoints
- [Agent Workflow](agent-workflow.md) — `forge do` intent router
- [Runtime Model](runtime-model.md) — commands vs actions vs workflows
- [forge add](forge-add.md) — integrations and dependency API oracle
- [CLI](cli.md) — inspect, AI, and verify commands
