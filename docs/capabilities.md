# Capabilities

ForgeOS has grown through milestones H1-H43. This page groups those milestones into public capabilities instead of exposing them as an implementation timeline.

## Capability map

| Capability | Enables | Main commands | Related docs |
|------------|---------|---------------|--------------|
| Compiler and graphs | Deterministic app understanding | `forge generate`, `forge inspect all --json` | [Architecture](architecture.md) |
| Runtime entries | Commands, queries, liveQueries, actions, workflows | `forge run`, `forge query`, `forge live` | [Runtime Model](runtime-model.md) |
| Data and policies | Tenant-scoped data, RBAC, RLS | `forge policy`, `forge rls check` | [Security and Data](security-and-data.md) |
| Secrets and env | Safe secret access and env validation | `forge secrets`, `forge env check` | [Security and Data](security-and-data.md) |
| Frontend contract | Hooks, routes, capability map | `forge inspect frontend --json` | [Frontend Integration Guide](frontend-integration-guide.md) |
| LiveQuery | Durable reactive updates | `forge live status --json` | [Frontend](frontend.md) |
| Package intelligence | Safe integrations and SDK API evidence | `forge add`, `forge deps api` | [Package Intelligence](package-intelligence.md) |
| Agent contract | Machine-readable project context | `forge agent print-context --json` | [Agent Contract](agent-contract.md) |
| Guided dev loop | Central local diagnostics and next actions | `forge dev`, `forge do` | [Dev Loop](dev-loop.md) |
| Authoring | Scaffold resources, UI, commands, workflows, AI chat | `forge make`, `forge feature` | [Authoring](authoring.md) |
| Refactor safety | AST-aware rename/extract codemods | `forge refactor` | [Codemods](codemods.md) |
| Testing and repair | Impact tests, repair plans, review, UI smoke | `forge impact`, `forge repair`, `forge review`, `forge ui` | [Testing and Repair](testing-and-repair.md) |
| Native AI agents | Tools, agents, auto-tools, chat endpoints | `forge ai`, `forge inspect agent-tools` | [AI Agents](ai-agents.md) |
| Operations | Self-host, release, Windows, Node path | `forge doctor`, `forge self-host`, `forge verify` | [Operations](operations.md) |

## How the pieces fit

```txt
source
  -> compiler graphs
  -> runtime guards
  -> generated contract
  -> dev diagnostics
  -> agent workflows
  -> verification and repair
```

The core idea stays the same across every capability: make the app explicit enough that agents can operate it safely.

## Milestone grouping

| Milestones | Public capability |
|------------|-------------------|
| H1-H3 | Compiler, examples, DataGraph |
| H4-H8 | Runtime, persistence, outbox, workflows |
| H9-H12 | Telemetry, auth/policy/tenant, secrets, AI workflows |
| H13-H17 | Queries, client SDK, liveQuery, React hooks, frontend template |
| H18-H24 | Self-host, agent contract, production auth, RLS, package planner, release bridge, production liveQuery |
| H25-H32 | Authoring, blueprints, codemods, impact tests, repair, adapters, review, UI bridge |
| H33-H38 | Intent router, full-stack contract, capability map, template hygiene, dev panel, fast generated checks |
| H39-H43 | Showcase app, Windows/Node hardening, verify observability, native AI tools and agents |

## Recommended reading paths

For new app builders:

1. [Getting Started](getting-started.md)
2. [First App Tutorial](tutorial-first-app.md)
3. [Runtime by Example](runtime-by-example.md)
4. [Frontend Integration Guide](frontend-integration-guide.md)

For AI coding agents:

1. [Agent Playbook](agent-playbook.md)
2. [Agent Workflow](agent-workflow.md)
3. [Agent Contract](agent-contract.md)
4. [Testing and Repair](testing-and-repair.md)

For production hardening:

1. [Security and Data](security-and-data.md)
2. [Production Readiness](production-readiness.md)
3. [Operations](operations.md)
4. [Self-Host](self-host.md)
5. [Release](release.md)
