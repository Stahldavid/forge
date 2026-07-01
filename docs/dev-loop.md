# Dev Loop

`forge dev` is the local control panel for a ForgeOS app.

It is the command humans keep running while they build, and the command agents use to get a deterministic snapshot before editing.

## Two modes

| Mode | Use when | Output |
|------|----------|--------|
| `forge dev` | Human local development | API URL, web URL, phase health, diagnostics, watch output |
| `forge dev --once --json` | Agents, CI, debugging, quick health checks | One JSON snapshot, then exit |

Use `forge dev` when you want a live local app. Use `forge dev --once --json` when an AI coder needs to understand what is broken before changing files.

## What it checks

`forge dev` coordinates the same surfaces an agent otherwise has to inspect manually:

- generated drift and cache status;
- Forge guard diagnostics;
- API runtime health;
- database adapter health;
- outbox worker health;
- workflow worker health;
- web dev server URL when `web/` exists;
- frontend routes and bridge files;
- capability map coverage;
- previous test, repair, review, and UI reports;
- recommended next action.

This is why `forge dev --once --json` is usually the first command after `forge do inspect --json`.

Generated apps should run the `forge` command or their `npm run forge -- ...` package script. In the ForgeOS framework checkout, maintainer diagnostics should use `node bin/forge.mjs ...` so `dev --once`, `status`, and generated AGENTS guidance come from the source tree being edited instead of a stale global install.

## Typical local session

```bash
forge do inspect --json
forge dev
```

Open the **web URL** for the user-facing app. The **API URL** is the Forge JSON runtime used by hooks, commands, queries, liveQueries, and AI endpoints.

When you are running multiple apps or an automated field test, let ForgeOS pick
both ports:

```bash
forge dev --port 0 --web-port 0
```

The dev output reports the concrete API and web URLs selected for that run.

For templates or apps with demo/bootstrap data, start with seed enabled:

```bash
forge dev --seed
```

`forge dev --seed` discovers generated seed commands, starts the API runtime,
runs the selected seed command through local dev-auth headers, and reports
`summary.seed` in JSON startup output, including `summary.seed.readiness` when a
seed command is available. Use `forge seed status --json` to inspect available
seed commands or `--seed-command <name>` when an app exposes more than one.
For multi-tenant field apps, add `--all-tenants` so startup runs the selected
seed command for every discovered local tenant/persona profile and reports
per-tenant seed evidence in `summary.seed.tenantRuns`.
`forge seed status --json` also reports `readiness.emptyWorkspaceRecovery`; use
those commands when the UI starts with an empty workspace.
It also reports `readiness.autoSeedMode`, plus
`readiness.autoSeedAllTenantsOnDev`, when `npm run dev` already uses
`forge dev --seed --all-tenants`.
When multiple local tenants exist but the dev script only seeds the default
tenant, `forge seed status` warns with `FORGE_SEED_DEV_PARTIAL_TENANTS` and
suggests `forge dev --seed --all-tenants` as the first recovery command.

If the API root returns `unknown route`, that is not a failed app. Inspect:

```bash
curl http://127.0.0.1:<api-port>/health
curl http://127.0.0.1:<api-port>/entries
```

## Agent snapshot

```bash
forge dev --once --json
```

Useful fields for agents:

| Field | Meaning |
|-------|---------|
| `phases` | Which local systems passed or failed |
| `diagnostics` | Guard, generated, frontend, or runtime errors |
| `frontend` | Routes, providers, bridge files, raw fetch warnings |
| `capabilities` | UI to command/query/liveQuery bindings |
| `doctor` | Project health summary |
| `nextAction` | Suggested command to run next |

An agent should not guess after a failed snapshot. It should use the diagnostics and fix hints.

## Common fixes

| Symptom | Start with |
|---------|------------|
| Generated files stale | `forge generate` |
| UI route not connected | `forge inspect capabilities --json` |
| Guard violation | `forge check --json` |
| Policy denied | `forge policy simulate <policy> --role <role> --json` |
| LiveQuery stale | `forge live status --json` |
| Windows runtime issue | `forge doctor windows --json` |

## Relationship to verification

`forge dev` is the feedback loop. It does not replace verification.

Before handoff:

```bash
forge generate
forge check --json
forge verify --standard
```

For release-grade work:

```bash
forge verify --strict
```

## Related pages

- [Agent Workflow](agent-workflow.md)
- [Frontend](frontend.md)
- [Testing and Repair](testing-and-repair.md)
- [Troubleshooting](troubleshooting.md)
