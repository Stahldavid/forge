# Basic Forge App

Demonstrates:

- generated integration surface (`src/forge/_generated/`, recreated locally)
- runtime matrix and import guards
- expected-fail transitive import guard demo (`guard-violation-demo/badStripeCommand.ts` → `stripeClient` → `stripe`)
- package-aware adapters from `forge add`
- event-driven actions via durable outbox (H7)
- lightweight workflows triggered by outbox events (H8)
- trace-correlated telemetry via `ctx.telemetry` (H9)
- a root `organizations` table with tenant-scoped `tickets.tenantId`

## Setup

From this directory:

```bash
npm run setup
npm run forge:generate
```

`setup` copies vendored type fixtures from the parent repo into `node_modules/` so the example works offline in CI.

This example is source-only. `src/forge/_generated/`, `forge.lock`, `bun.lock`, `node_modules/`, and operational `.forge/**` files are intentionally ignored and recreated by setup/generate commands.

## Verify

```bash
npm run verify
```

This should pass for the main example app.

`src/actions/createCheckout.ts` is allowed: Stripe is compatible with the `action` context, and the secret is read through `ctx.secrets`.

## Import guard demo

The expected-fail guard demo is kept outside `src/` so normal verification stays green.

```bash
cp guard-violation-demo/badStripeCommand.ts src/commands/badStripeCommand.ts
npm run forge:check
rm src/commands/badStripeCommand.ts
```

`forge check` reports `FORGE_GUARD_VIOLATION` because the copied command transitively imports Stripe in a `command` context.

## Run commands locally

After `forge:generate`:

```bash
npm run forge:run -- --list
npm run forge:run -- createTicket
npm run forge:run -- createCheckout --mock
```

## Event-driven flow (H7)

1. `createTicket` command inserts a row and emits `ticket.created` into the transactional outbox.
2. On commit, the compiler-generated subscriptions create delivery rows for `captureTicketCreated`.
3. The outbox worker (CLI or `forge dev --worker`) runs the subscribed action with the event payload.

```bash
npm run forge:run -- createTicket
npm run forge -- outbox list
npm run forge -- outbox process --once
```

`src/actions/captureTicketCreated.ts` subscribes to `ticket.created` and returns `{ captured: true, ticketId }`.

## Workflow flow (H8)

1. `createTicket` emits `ticket.created` into the outbox (same as H7).
2. The worker starts `triageTicketWorkflow` from `workflowSubscriptions`.
3. Steps run sequentially: `loadTicket` → `triageWithAI` → `captureAnalytics`.

```bash
npm run forge:run -- createTicket
npm run forge -- workflow list
npm run forge -- workflow process --once
npm run forge -- workflow inspect 1
```

`src/workflows/triageTicketWorkflow.ts` triggers on `ticket.created` and receives the outbox payload as run input.

## Telemetry flow (H9)

1. `createTicket` calls `ctx.telemetry.capture("ticket_create_started")` and `ticket_created` inside the command transaction.
2. On commit, events land in `_forge_telemetry_events` with a shared `traceId` also embedded in the outbox payload.
3. `captureTicketCreated` correlates via outbox `deliveryId` and inherited `traceId`.
4. `triageTicketWorkflow` steps share the same trace and can open spans via `ctx.telemetry.span`.

```bash
npm run forge:run -- createTicket
npm run forge -- telemetry list
npm run forge -- telemetry flush --sink local
npm run forge -- telemetry tail --file events
```

Local sink output: `.forge/local/telemetry/*.jsonl` (gitignored).

## Database (H6)

After `forge:generate`:

```bash
npm run forge:db:migrate
npm run forge:db:reset
```

`createTicket` persists rows to the tenant-scoped `tickets` table and writes `ticket.created` to the transactional outbox. The example uses `organizations` as the root tenant resource and `tickets.tenantId` as the scoped foreign key.

## Dev server

After `forge:generate`:

```bash
npm run forge:dev:db
# with background worker (outbox + workflows):
npm run forge:dev -- --worker --db pglite
# or with mocks:
npm run forge:dev -- --watch --mock --db pglite
```

Then invoke handlers over HTTP:

```bash
curl -X POST http://127.0.0.1:3765/commands/createTicket \
  -H "Content-Type: application/json" \
  -d '{"args":{"title":"demo"}}'

curl http://127.0.0.1:3765/outbox
curl -X POST http://127.0.0.1:3765/outbox/process
```

## Scripts

| Script | Description |
|--------|-------------|
| `setup` | Seed `node_modules` from compiler test fixtures |
| `forge:generate` | Run the Forge compiler against this app |
| `forge:check` | Validate import guards |
| `forge:run` | List or execute local command/action handlers |
| `forge:dev` | Start local HTTP dev server with optional watch mode |
| `forge:dev:db` | Dev server with PGlite persistence |
| `forge:db:migrate` | Apply SQL migrations to local PGlite |
| `forge:db:reset` | Reset local PGlite schema and data |
| `verify` | Run `generate --check`, `forge check`, and typecheck |
