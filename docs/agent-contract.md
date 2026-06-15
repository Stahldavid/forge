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
- Secret names, never secret values.
- AI providers, model calls, tools, agents, approval hints, and runtime placement.
- Agent endpoints: `/ai/agents/run` for JSON automation and `/ai/agents/chat` for AI SDK UIMessage streaming.
- Frontend routes, components, providers, bridge files, and client bindings.
- Verification commands and common operation playbooks.

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
```

An agent should read `AGENTS.md`, inspect the project, make a targeted change, regenerate, and then verify.
