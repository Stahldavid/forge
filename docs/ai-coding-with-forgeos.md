# AI Coding with ForgeOS

ForgeOS is the contract layer for agentic software development. It turns an app into a machine-readable system contract so coding agents can inspect capabilities, understand data flow, respect policies, make changes, and verify impact without guessing the architecture.

The strongest first use case is not "create a CRUD app." It is:

> Use ForgeOS to understand an existing app, make a small safe change, verify the impact, and produce a handoff.

## The agent prompt

Use a prompt like this in Codex, Claude Code, Cursor, or another coding agent:

```txt
Use ForgeOS to inspect this app, add project invites, verify the change, and produce a handoff.
Start with forge do inspect --json, forge dev --once --json, and forge inspect capabilities --json.
Do not edit generated files.
Use forge test plan --changed --json before choosing tests.
```

## The loop

```bash
forge do inspect --json
forge status --json
forge changed --json
forge handoff --json
forge dev --once --json
forge inspect capabilities --json
```

After editing:

```bash
forge generate
forge check
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge verify --standard
forge handoff --json
```

## Agent adapter setup

ForgeOS already exports persistent instructions for common coding agents. Use the existing agent adapter commands rather than a second `ai-files` command surface:

```bash
forge agent onboard --target codex --json
forge agent export --target claude
forge agent export --target cursor
forge agent export --target generic
```

`onboard` prepares the adapter, hook bridge, memory status, and development snapshot where supported. `export` writes the static instruction files for agents that only need persistent project context.

## What the contract gives the agent

| Agent question | ForgeOS artifact or command |
|----------------|-----------------------------|
| What can this app do? | `agentContract.json`, `forge inspect all --json` |
| Which UI uses this backend operation? | `capabilityMap.json`, `forge inspect capabilities --json` |
| Which files are generated? | `AGENTS.md`, `forge changed --json` |
| Where can side effects run? | `runtimeRules.md`, `forge check` |
| Which packages are safe in this runtime? | `packageGraph.json`, `forge deps runtime-compat` |
| What tests should run? | `forge test plan --changed --json` |
| What changed and what is left? | `forge handoff --json` |

## Why this differs from a normal framework

Traditional frameworks organize code for humans. ForgeOS organizes the application for humans and agents:

- runtime entries are explicit;
- generated clients and hooks are linked back to source operations;
- policies, secrets, tenant scope, and AI tools appear in one contract;
- frontend/backend drift becomes inspectable;
- package usage has runtime placement checks;
- verification commands are part of the handoff.

## Recommended first demos

1. Agent understands app: run inspect commands and show the contract.
2. Agent makes a safe change: add one field, command, query, or UI binding and run verification.
3. Agent is blocked by policy: introduce a boundary violation and show `forge check` or `forge verify` stopping it.

See [Agent-Native Demos](demos.md) for scripts.

## Related pages

- [Stable Alpha Surface](stable-alpha.md)
- [Agent Workflow](agent-workflow.md)
- [Agent Contract](agent-contract.md)
- [Package Intelligence](package-intelligence.md)
