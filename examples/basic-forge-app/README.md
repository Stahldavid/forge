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

## Dev server

After `forge:generate`:

```bash
bun run forge:dev -- --watch --mock
```

Then invoke handlers over HTTP, for example `POST http://127.0.0.1:3765/run/createTicket`.

## Scripts

| Script | Description |
|--------|-------------|
| `setup` | Seed `node_modules` from compiler test fixtures |
| `forge:generate` | Run the Forge compiler against this app |
| `forge:check` | Validate import guards |
| `forge:run` | List or execute local command/action handlers |
| `forge:dev` | Start local HTTP dev server with optional watch mode |
| `verify` | Run `generate --check`, `forge check`, and typecheck |
