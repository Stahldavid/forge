# Basic Forge App

Demonstrates:

- generated integration surface (`src/forge/_generated/`)
- runtime matrix and import guards
- transitive import guard (`badStripeCommand` → `stripeClient` → `stripe`)
- package-aware adapters from `forge add`

## Setup

From this directory:

```bash
bun run setup
bun run forge:generate
```

`setup` copies vendored type fixtures from the parent repo into `node_modules/` so the example works offline in CI.

## Verify

```bash
bun run verify
```

`forge check` reports `FORGE_GUARD_VIOLATION` for `src/commands/badStripeCommand.ts` because it transitively imports Stripe in a `command` context.

`src/actions/createCheckout.ts` is allowed: Stripe is compatible with the `action` context.

## Run commands locally

After `forge:generate`:

```bash
bun run forge:run -- --list
bun run forge:run createTicket
bun run forge:run badStripeCommand   # blocked by import guards
bun run forge:run createCheckout --mock
```

## Database (H6)

After `forge:generate`:

```bash
bun run forge:db:migrate
bun run forge:db:reset
```

`createTicket` persists rows to the `tickets` table and writes `ticket.created` to the transactional outbox.

## Dev server

After `forge:generate`:

```bash
bun run forge:dev:db
# or with mocks:
bun run forge:dev -- --watch --mock --db pglite
```

Then invoke handlers over HTTP:

```bash
curl -X POST http://127.0.0.1:3765/commands/createTicket \
  -H "Content-Type: application/json" \
  -d '{"args":{"title":"demo"}}'
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
