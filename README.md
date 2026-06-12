# ForgeOS

Agent-native application framework and compiler for building Forge apps without a mandatory dashboard. ForgeOS turns application source into deterministic runtime contracts, generated clients, safety checks, and machine-readable context that humans and AI coding agents can use safely.

**Status:** private MVP, implemented through H32. The core compiler, local runtime, frontend SDK, production auth, RLS compiler, repair/review loops, and UI test bridge are present. Public release still needs packaging hardening, broader Node compatibility, and more AST-first codemods.

## Agent-First Quickstart

```bash
bun install --ignore-scripts
bun run forge generate
bun run forge dev
bun run forge dev --once --json
bun run forge inspect all --json
bun run forge doctor
bun run forge verify --strict
```

When working as an AI coder, read:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/runtimeRules.md
src/forge/_generated/appMap.md
src/forge/_generated/operationPlaybooks.md
```

These files describe the app surface, runtime rules, generated files, policies, secrets, workflows, UI routes, commands to run, and common repair/refactor playbooks.

## Create a Test App

```bash
forge new notes-app --template minimal-web
cd notes-app
bun run dev -- --open
```

`forge dev` starts the API runtime and the web dev server together when a `web/` app exists. The `--once --json` mode is the central agent/CI diagnostic entrypoint: it checks generated drift, guardrails, frontend routes/bindings, doctor status, impact, and the last test/UI reports in one deterministic response.

Template apps ignore `src/forge/_generated/` and `forge.lock` by default so a freshly created app does not flood git with generated files. Run `forge generate` after checkout or before verification to recreate the agent contract, client SDK, frontend graph, and runtime manifests.

## What ForgeOS Generates

```txt
src/forge/_generated/
  api.ts/json
  client.ts, clientTypes.ts, clientApi.ts
  react.ts, reactManifest.ts/json
  appGraph.ts/json
  dataGraph.ts/json
  runtimeGraph.ts/json
  runtimeMatrix.ts/json
  policyRegistry.ts/json
  permissionMatrix.ts/json
  tenantScope.ts/json
  secretRegistry.ts/json
  aiRegistry.ts/json
  workflowRegistry.ts/json
  liveQueryRegistry.ts/json
  agentContract.ts/json
  agentAdapterManifest.ts/json
  testGraph.ts/json
  uiTestManifest.ts/json
  uiRoutes.ts/json
  uiScenarios.ts/json
```

Project-level generated context:

```txt
AGENTS.md
forge.lock
.forge/test-plans/**
.forge/repairs/**
.forge/refactors/**
.forge/ui-runs/**
```

## Core Capabilities

| Area | What exists now |
| --- | --- |
| Compiler | AppGraph, DataGraph, RuntimeGraph, PackageGraph, deterministic generated artifacts, drift checks |
| Runtime | commands, queries, liveQueries, actions, workflows, durable outbox, local dev server |
| Data | schema compiler, SQL DDL, migrations, PGlite/Postgres adapter, tenant scope metadata |
| Policies | RBAC policy registry, permission matrix, simulation, strict policy checks |
| Auth | dev headers, JWT, OIDC discovery/JWKS verification via `jose`, production-mode guardrails |
| RLS | Postgres RLS SQL compiler/checks for DB-enforced tenant isolation |
| Secrets/env | secret registry, env schema, redaction, strict `process.env` checks |
| AI | provider registry, `ctx.ai`, mock mode, telemetry without prompt/output retention by default |
| Frontend | generated client SDK, React/Next hooks, template app, liveQuery client support |
| LiveQuery | durable invalidation log, reconnect/resume semantics, production hardening checks |
| Self-host | compose/deploy artifacts and self-host checks |
| Agent contract | `AGENTS.md`, `agentContract.json`, app maps, runtime rules, playbooks, inspect/doctor |
| Authoring | `forge make`, feature blueprints, safe refactor plans, package upgrade plans |
| Testing/repair | impact-based test planner, repair loop, structured review, UI/browser test bridge |
| Adapters | agent adapter export for external AI tools |

## Command Map

Prefer task-oriented commands first:

```bash
forge dev --once --json
forge dev
forge inspect all --json
forge doctor
forge verify --strict
forge impact --changed --json
forge test plan --changed --json
forge repair diagnose --from-last-test-run --json
forge repair diagnose --from-last-ui-run --json
forge review run --changed --json
forge ui smoke --json
```

Common command groups:

| Command | Purpose |
| --- | --- |
| `forge generate` | Analyze source and emit generated artifacts |
| `forge generate --check` | Fail on generated drift |
| `forge check --json` | Validate guardrails and emit diagnostics with fix hints |
| `forge verify --strict` | CI gate: generate/check/policy/secrets/auth/RLS/agent checks/typecheck/tests |
| `forge inspect <target> --json` | Inspect generated app/data/runtime/policy/client/agent/UI surfaces |
| `forge doctor --json` | Human/agent health check for project coherence |
| `forge dev` | Interactive local loop: generated checks, API runtime, DB, worker, watch mode, frontend server, URLs, and next agent checks |
| `forge dev --once --json` | One-shot diagnostic orchestrator for agents/CI: generated drift, check, frontend, doctor, impact, reports, next actions |
| `forge run`, `forge query`, `forge live` | Execute and inspect runtime entries locally |
| `forge db`, `forge rls` | Diff/migrate/status and inspect/check RLS |
| `forge policy`, `forge secrets`, `forge env`, `forge auth` | Security and configuration operations |
| `forge make` | Scaffold resources, commands, queries, policies, actions, workflows |
| `forge feature` | Validate/plan/apply feature blueprints |
| `forge refactor` | Plan/apply/rollback safe refactors and targeted codemods |
| `forge impact`, `forge test` | Compute change impact and run targeted checks |
| `forge repair` | Diagnose failures and produce repair plans |
| `forge review` | Structured code review with findings and suggested commands |
| `forge ui` | Browser/UI smoke, scenario, route, snapshot, doctor, and reports |
| `forge deps` | Package upgrade planning and application |
| `forge release` | Release/source-map bridge and symbolication |
| `forge agent`, `forge agent-contract` | Agent-facing contract and adapter exports |
| `forge self-host` | Self-host packaging and checks |

## Runtime Rules

Commands are transactional and deterministic:

- allowed: `ctx.db`, `ctx.emit`, buffered telemetry
- forbidden: network packages, direct integrations, `ctx.secrets`, `ctx.ai`, direct `process.env`

Queries and liveQueries are read-only:

- allowed: scoped DB reads
- forbidden: writes, emits, secrets, AI, network integrations

Actions and workflows handle side effects after commit:

- allowed: integrations, secrets, AI, network packages, retries
- expected: idempotent behavior and traceable telemetry

Use `src/forge/_generated/runtimeRules.md` as the canonical generated version.

## Example App

See [`examples/basic-forge-app`](examples/basic-forge-app/README.md).

```bash
cd examples/basic-forge-app
bun run setup
bun run forge:generate
bun run forge:check
```

The example covers allowed command dependencies, forbidden transitive imports, generated APIs, and guard diagnostics.

## Platform Support

| Platform | Support |
| --- | --- |
| Linux | Supported for MVP development |
| macOS | Supported for MVP development |
| Windows (WSL) | Supported for MVP development |
| Windows (native) | Experimental |

Known Windows note: invoke Bun from the real install path if `bun` on PATH is hijacked by another app association:

```powershell
& "$env:USERPROFILE\.bun\bin\bun.exe"
```

ForgeOS is still Bun-first. The current repo uses Bun scripts and Bun tests; Node-compatible CLI packaging remains a future hardening item.

## Verification

Fast focused checks:

```bash
bun run typecheck
bun run lint
bun test tests/<area>
bun run forge generate --check
```

Full gate:

```bash
bun test --timeout 120000
bun run forge verify --strict
```

UI bridge note: `forge ui` uses Playwright when installed. Without Playwright, `forge ui doctor --json` reports `FORGE_UI_PLAYWRIGHT_MISSING` with fix hints instead of silently failing.

Frontend bridge note: `forge inspect frontend --json` and `forge dev --once --json` expose routes, components, `ForgeProvider`, generated client bindings, raw runtime fetch warnings, and fix hints. Agents should use this before editing UI wiring.

## Milestone History

```txt
H1   Hardening, CI, examples
H2   Reference integration quality
H3   DataGraph Compiler
H4   Local command/action runtime
H5   Local dev server
H6   DataGraph-backed persistence runtime
H7   Durable outbox worker
H8   Lightweight workflow engine
H9   Telemetry bridge
H10  Auth, policy engine, tenant isolation
H11  Secrets & environment runtime
H12  AI workflow integration
H13  Query runtime & typed API surface
H14  Frontend client SDK core
H15  LiveQuery/Reactivity MVP
H16  React/Next hooks
H17  Minimal frontend app template
H18  Self-host packaging
H19  Agent Contract & Project Introspection Layer
H20  Production Auth / JWT & OIDC v1
H21  Postgres RLS Compiler & DB-enforced tenant isolation
H22  Package Upgrade Planner
H23  Release / Source Map Bridge
H24  Production LiveQuery Hardening
H25  Authoring primitives: forge make
H26  Feature Blueprint Compiler
H27  Safe Refactor / Codemod Engine
H28  Impact-Based Test Planner
H29  Repair Loop
H30  Agent Adapter Export
H31  Forge Review / Structured Code Review
H32  UI / Browser Test Bridge
```

## Remaining Hardening Before Public Release

- Keep expanding AST-first refactors; avoid broad regex rewrites for semantic TypeScript changes.
- Reduce command-selection risk with more task routers and richer inline diagnostics.
- Improve native Windows setup and package the CLI so broken PATH/app associations cannot block usage.
- Add Node-compatible paths for Bun-specific internals where practical.
- Broaden UI bridge coverage with installed Playwright browsers in CI.
