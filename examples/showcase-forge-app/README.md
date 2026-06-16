# ForgeOS Agent-Native Support App

This is the public proof app for ForgeOS.

It is intentionally small enough to understand in one sitting, but complete enough to demonstrate the core ForgeOS thesis: an AI coding agent can inspect the app contract, understand runtime boundaries, change source files, verify frontend/backend wiring, and finish with deterministic checks.

## What this proves

The app is a support desk with tickets, policies, live updates, workflow triage, telemetry, and a connected web UI.

| ForgeOS capability | Evidence in this app |
|--------------------|----------------------|
| Data graph | `src/forge/schema.ts` defines tenant-scoped `tenants`, `users`, and `tickets` |
| Policies | `src/policies.ts` defines ticket and billing permissions |
| Transactional command | `src/commands/createTicket.ts` writes a ticket and emits `ticket.created` |
| Policy denial | `src/commands/manageBilling.ts` requires `billing.manage`; the UI demo runs as `member` |
| Query/liveQuery | `src/queries/listTickets.ts`, `src/queries/getTicket.ts`, `src/queries/liveTickets.ts` |
| Outbox action | `src/actions/captureTicketCreated.ts` handles `ticket.created` after commit |
| Workflow | `src/workflows/triageTicketWorkflow.ts` performs mock AI triage after commit |
| Frontend contract | `web/app/tickets/page.tsx` and components use generated Forge hooks |
| Capability map | `forge inspect capabilities --json` connects UI components to runtime entries |
| Agent contract | `forge agent print-context --json` exposes the app to coding agents |
| Verification loop | `forge dev --once --json`, `forge check --json`, `forge verify --standard` |

## Run it

```bash
npm install
npm run generate
npm run dev
```

`forge dev` starts the Forge API runtime, PGlite database, outbox worker, watcher, and Next.js web app together.

Open the web URL printed by `forge dev`. The API URL is for JSON runtime calls and health checks.

## Public proof path

Run these commands after install:

```bash
npm run proof:inspect
npm run proof:dev
npm run proof:capabilities
npm run proof:verify
```

They prove four things:

1. ForgeOS can inspect the app as structured context.
2. The local runtime can start and report health as JSON.
3. Frontend routes/components are connected to Forge runtime entries.
4. The app passes the standard agent handoff gate.

## Agent demo script

Give an AI coding agent this task:

```txt
Add a ticket priority filter to the support app.

Before editing, inspect the ForgeOS contract and frontend capability map.
Do not edit generated files.
Finish with forge generate, forge check --json, and forge verify --standard.
```

Expected agent loop:

```bash
npm run forge -- do inspect --json
npm run forge -- dev --once --json
npm run forge -- inspect all --json
npm run forge -- inspect capabilities --json
```

Then the agent should edit source files only, likely:

```txt
src/queries/liveTickets.ts
web/components/TicketList.tsx
web/app/tickets/page.tsx
```

Finish:

```bash
npm run generate
npm run forge -- check --json
npm run forge -- verify --standard
```

## Things to click

In the web app:

1. Open `/tickets`.
2. Create a ticket.
3. Watch the live ticket list update.
4. Inspect the trace output after command errors.
5. Click `Try billing.manage` to see policy denial for a non-owner role.

The policy denial is intentional. It proves that UI actions still run through Forge policies.

## What agents should read

After `npm run generate`, inspect:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/appMap.md
src/forge/_generated/runtimeRules.md
src/forge/_generated/frontendGraph.json
src/forge/_generated/capabilityMap.json
```

These files are generated context. Read them, but do not edit them.

## Source-only by design

Generated files and operational state are not committed here:

```txt
src/forge/_generated/
forge.lock
.forge/cache/
.forge/pglite/
.forge/repairs/
.forge/refactors/
.forge/upgrades/
.forge/reviews/
.forge/impact/
.forge/agent-adapters/
```

Run `npm run generate` after checkout to recreate generated artifacts.

## Why this app matters

Most framework demos show that a human can build a toy app.

This demo is different: it shows that the app can explain itself to an AI coding agent. ForgeOS exposes the runtime model, policies, generated client surface, frontend bindings, package rules, diagnostics, and verification commands as stable files and JSON commands.

That is the ForgeOS promise in one app.

## Related docs

- [Capabilities](https://forgeos.readthedocs.io/en/latest/capabilities/)
- [Agent Playbook](https://forgeos.readthedocs.io/en/latest/agent-playbook/)
- [Dev Loop](https://forgeos.readthedocs.io/en/latest/dev-loop/)
- [Runtime by Example](https://forgeos.readthedocs.io/en/latest/runtime-by-example/)
- [Frontend Integration Guide](https://forgeos.readthedocs.io/en/latest/frontend-integration-guide/)
