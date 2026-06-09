# Forge Compiler

Deterministic codegen compiler for Forge apps. Parses Forge builder APIs, analyzes package integrations statically, classifies runtime contexts, and emits `src/forge/_generated/` plus `forge.lock`.

**Status:** MVP compiler implementation complete. Needs hardening before public release.

## Quickstart

```bash
bun install --ignore-scripts
bun run typecheck
bun test
bun run forge generate
bun run forge verify
```

## CLI

| Command | Description |
|---------|-------------|
| `forge generate` | Analyze workspace and emit generated files |
| `forge generate --check` | Fail on drift without writing |
| `forge add <alias>` | Add a reference integration (`stripe`, `posthog`, `sentry`, `zod`, `ai`) |
| `forge inspect <target>` | Inspect generated app/packages/runtime-matrix/data/runtime/dev |
| `forge run [name]` | List or execute local command/action handlers (`--list`, `--mock`) |
| `forge dev` | Local HTTP dev server with invoke routes (`--watch`, `--mock`, `--port`, `--db`, `--worker`) |
| `forge db <diff\|migrate\|reset\|status>` | SQL migrations against PGlite (default) or Postgres |
| `forge outbox <list\|process\|retry\|dead\|clear>` | Inspect and process durable outbox deliveries |
| `forge workflow <list\|run\|inspect\|process\|retry\|cancel>` | Lightweight workflow engine (runs, steps, worker) |
| `forge telemetry <list\|inspect\|flush\|tail\|clear>` | Trace-correlated telemetry buffer, sinks, and inspection |
| `forge check` | Validate transitive import guards |
| `forge verify` | CI/dogfood aggregator (`generate --check`, `forge check`, typecheck, tests, guard lint) |

Flags: `--json`, `--dry-run`, `--skip-tests`, `--skip-typecheck`, `--skip-eslint`.

## Example app

See [`examples/basic-forge-app`](examples/basic-forge-app/README.md) for a minimal app with:

- Zod in a `command` (allowed)
- Stripe in an `action` (allowed)
- Stripe transitively in a `command` (`FORGE_GUARD_VIOLATION`)

```bash
cd examples/basic-forge-app
bun run setup
bun run forge:generate
bun run forge:check
```

## Platform support

| Platform | Support |
|----------|---------|
| Linux | Supported |
| macOS | Supported |
| Windows (native) | Experimental — use WSL for MVP |
| Windows (WSL) | Supported |

### Known issues

1. **tree-sitter native postinstall** — On some Windows setups, `bun install` fails on the native `tree-sitter` postinstall script. Use:

   ```bash
   bun install --ignore-scripts
   ```

   The compiler requires Bun (uses `Bun.CryptoHasher` and tree-sitter). Track: evaluate `web-tree-sitter` backend to avoid native postinstall problems.

2. **`bun` PATH on Windows** — Ensure Bun is on your PATH, or invoke it by full path.

## CI

GitHub Actions runs:

```bash
bun install --ignore-scripts
bun run typecheck
bun test
bun run forge generate
bun run forge verify --skip-tests
# example app setup + generate --check
```

## Optional smoke tests (real network installs)

```bash
FORGE_SMOKE_REAL=1 bun test tests/smoke --timeout 120000
```

## Roadmap

1. **H1** — Hardening, CI, examples ✅
2. **H2** — Reference integration quality (recipe v2 templates) ✅
3. **H3** — DataGraph Compiler ✅
4. **H4** — Local command/action runtime (`forge run`, runtimeGraph, mocks) ✅
5. **H5** — Local dev server (`forge dev`, devManifest, watch mode) ✅
6. **H6** — DataGraph-backed persistence runtime (PGlite, db CLI, transactional outbox) ✅
7. **H7** — Durable outbox worker and event-driven actions ✅
8. **H8** — Lightweight workflow engine on outbox worker ✅

### H9 deliverables (telemetry bridge v1)

| Artifact | Description |
|----------|-------------|
| `telemetryRegistry.json` / `.ts` | Static index of `ctx.telemetry.capture("event")` calls |
| `telemetrySinks.json` / `.ts` | Installed sink map (`local`, `posthog`, `sentry`) |
| `_forge_telemetry_events` / `_forge_trace_spans` | Buffered events and OpenTelemetry-inspired spans |
| `ctx.telemetry` | Runtime context on commands, actions, and workflow steps |
| `forge telemetry` | `list`, `inspect`, `flush`, `tail`, `clear` subcommands |

```bash
forge telemetry list --json
forge telemetry inspect <traceId>
forge telemetry flush --sink local
forge telemetry tail --file events
forge inspect telemetry
forge dev --telemetry local,posthog --worker --db pglite
```

**Architecture:** Commands buffer telemetry inside the DB transaction (rolls back with the tx). Runner-captured exceptions persist outside the tx after rollback. Actions and workflow steps write telemetry immediately and can flush to sinks. `traceId` propagates command → outbox payload → action → workflow steps.

**Limitations:** no OTLP exporter, distributed trace backend, or production-grade telemetry pipeline — local JSONL + H2 adapter sinks only.

### H8 deliverables (workflow engine)

| Artifact | Description |
|----------|-------------|
| `workflowRegistry.json` / `.ts` | Static index of `workflow({ trigger, steps })` definitions |
| `workflowSubscriptions.json` / `.ts` | Event → workflow subscription map |
| `_forge_workflow_runs` / `_forge_workflow_steps` | Durable run and step state with retry/dead-letter |
| `forge workflow` | `list`, `run`, `inspect`, `process`, `retry`, `cancel` subcommands |
| Worker integration | `forge dev --worker` tick: start runs → outbox → workflow steps |

```bash
forge workflow list --json
forge workflow run triageTicketWorkflow --input '{"id":"..."}'
forge workflow inspect 1
forge workflow process --once
forge inspect workflows
forge dev --worker --db pglite
```

**Architecture:** Commands emit outbox events transactionally. After commit, the worker starts workflow runs from subscriptions, processes outbox action deliveries (H7), then executes workflow steps sequentially with persisted outputs.

**Limitations:** no Temporal/distributed orchestration, parallel step execution, human-in-the-loop, or production-grade workflow scaling.

### H7 deliverables (outbox worker)

| Artifact | Description |
|----------|-------------|
| `actionSubscriptions.json` / `.ts` | Static index of `action({ event })` subscriptions |
| `_forge_outbox_deliveries` | Per-action delivery rows with retry/dead-letter state |
| `forge outbox` | `list`, `process`, `retry`, `dead`, `clear` subcommands |
| Outbox worker | Processes deliveries after command commit |
| `forge dev --worker` | Background worker loop alongside HTTP server |

```bash
forge outbox list --json
forge outbox process --once
forge outbox retry 42
forge outbox dead
forge dev --worker --db pglite
forge inspect subscriptions
```

**Architecture:** Option B — separate `_forge_outbox` (events) and `_forge_outbox_deliveries` (per-action retry). Commands stay transactional; subscribed actions run via worker after commit.

**Limitations:** no distributed workers, SKIP LOCKED, liveQuery, or production queue scaling.

### H6 deliverables (persistence runtime)

| Artifact | Description |
|----------|-------------|
| `sqlPlan.json` / `sqlPlan.ts` | DataGraph → SQL DDL plan with system tables |
| `db.json` / `db.ts` | Generated `tableMap` for typed DB client |
| `forge db` | `diff`, `migrate`, `reset`, `status` subcommands |
| PGlite adapter | Default local DB at `.forge/pglite` |
| Command transactions | `command({ handler })` with `ctx.db` + `ctx.emit` outbox |

```bash
forge db migrate
forge db reset --db pglite
forge db status --json
forge dev --db pglite
forge dev --db postgres --database-url "$DATABASE_URL"
```

**Limitations:** no RLS, liveQuery, workflow engine, CDC, or destructive migration diff.

### H5 deliverables (dev server)

| Artifact | Description |
|----------|-------------|
| `devManifest.json` | Stable HTTP route manifest for local dev |
| `devManifest.ts` | Typed export of dev routes and entry metadata |
| `forge dev` | Bun HTTP server exposing runtime invoke over HTTP |

Default listen address: `http://127.0.0.1:3765` (override with `--port` / `--host` or `FORGE_DEV_PORT`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Server liveness, entry count, DB, outbox, workflow, and telemetry status |
| `GET` | `/outbox` | Outbox summary and delivery list |
| `POST` | `/outbox/process` | Process one outbox batch |
| `GET` | `/db/tables` | List migrated tables |
| `GET` | `/entries` | Runtime graph entries |
| `GET` | `/workflows` | Workflow registry and manifest metadata |
| `GET` | `/workflows/runs` | List workflow runs |
| `GET` | `/workflows/runs/:id` | Inspect a workflow run and steps |
| `POST` | `/workflows/:name/run` | Start a manual workflow run (`{ input }`) |
| `POST` | `/workflows/process` | Run worker tick (start runs + outbox + steps) |
| `POST` | `/workflows/runs/:id/retry` | Retry a failed/dead workflow run |
| `POST` | `/workflows/runs/:id/cancel` | Cancel a workflow run |
| `POST` | `/run/:name` | Invoke command or action by name |
| `POST` | `/commands/:name` | Invoke command entry only |
| `POST` | `/actions/:name` | Invoke action entry only |
| `GET` | `/telemetry` | Telemetry summary and buffered events |
| `GET` | `/telemetry/traces/:traceId` | Inspect a trace (events + spans) |
| `POST` | `/telemetry/flush` | Flush pending telemetry to configured sinks |

```bash
forge dev
forge dev --worker --watch --mock
forge dev --port 4000 --json
forge inspect dev
```

**Limitations:** local development only — not production deployment; workflow engine is lightweight (sequential steps, single-worker).

### H4 deliverables (local runtime)

| Artifact | Description |
|----------|-------------|
| `runtimeGraph.json` | Command/action entries with module linkage |
| `runtimeRegistry.ts` | Name → handler metadata map |
| `mockMap.ts` | Package → testkit path for `--mock` runs |
| `forge run` | Execute handlers locally with guard preflight |

```bash
forge run --list
forge run createTicket
forge run createTicket --mock
```

### H3 deliverables (DataGraph)

- `dataGraph.json` / `dataGraph.ts` — schema.table extraction from AppGraph

### H2 deliverables (recipe v2.0.0)

| Integration | Generated artifacts |
|-------------|---------------------|
| **zod** | `zod.shared.ts` with real `z` re-export |
| **stripe** | `stripe.server.ts`, `stripe.workflow.ts`, `integrations/stripe/webhook.ts`, `stripe.mock.ts` |
| **posthog** | client/server adapters, `integrations/posthog/events.ts`, `flags.ts` |
| **sentry** | Next.js-target adapters, `errors.ts`, `releases.ts`, `sourcemaps.ts` |
| **ai** | `ai.server.ts`, `generations.ts`, `evals.ts`, OpenAI/Anthropic provider modules |
