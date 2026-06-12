# ForgeOS Showcase App

This is the canonical small app for testing ForgeOS as an agent-native full-stack framework.

It is intentionally source-only: generated files and `forge.lock` are not committed here.
Run `bun run generate` to recreate them.

## Run

```bash
bun install
bun run generate
bun run dev
```

`forge dev` starts the Forge API, PGlite, worker, watcher, and the Next.js web app together.

Open:

- Web: http://127.0.0.1:3000
- API health: http://127.0.0.1:3765/health

## What It Demonstrates

- tenant-scoped data tables: `tenants`, `users`, `tickets`
- policies and permission matrix
- transactional commands: `createTicket`, `closeTicket`, `manageBilling`
- read queries and live queries: `listTickets`, `getTicket`, `liveTickets`
- outbox action after commit: `captureTicketCreated`
- workflow subscription: `triageTicketWorkflow`
- mock AI workflow step
- telemetry trace IDs surfaced in the UI
- generated React hooks through `web/lib/forge.ts`
- `frontendGraph`, `agentContract`, and `capabilityMap` generation
- `forge dev --once --json` as the one-shot agent diagnostic loop

## Agent Loop

```bash
bun run forge do inspect --json
bun run forge dev --once --json
bun run forge inspect capability-map --json
bun run forge verify --strict
```

The expected happy path is:

1. read `AGENTS.md`
2. run `forge dev --once --json`
3. inspect `src/forge/_generated/agentContract.json`
4. inspect `src/forge/_generated/capabilityMap.json`
5. edit source files only
6. finish with `forge verify --strict`

## Files To Avoid Committing

The app `.gitignore` excludes generated and operational files:

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

If these files appear locally, that is normal. They are recreated by ForgeOS.
