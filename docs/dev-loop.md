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

## Typical local session

```bash
forge do inspect --json
forge dev
```

Open the **web URL** for the user-facing app. The **API URL** is the Forge JSON runtime used by hooks, commands, queries, liveQueries, and AI endpoints.

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
