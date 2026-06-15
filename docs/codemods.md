# Codemods

Forge provides **refactor codemods** for safe, reviewable changes across schema, runtime entries, and guard violations. Codemods plan changes, show impact, snapshot files for rollback, and integrate with `forge generate` and `forge verify`.

Always start with **`--dry-run --json`** when an agent or human touches schema, policies, or runtime wiring.

## Command overview

```bash
forge refactor list
forge refactor rename field <table.old> <table.new> --dry-run --json
forge refactor rename table <from> <to> --dry-run --json
forge refactor extract-action <command> --package <npm> --dry-run --json
forge refactor replace-process-env <ENV_VAR> --dry-run --json
forge refactor replace-import <from> <to> --dry-run --json
forge refactor apply <plan-id> --yes
forge refactor rollback <plan-id>
```

Common flags:

| Flag | Purpose |
|------|---------|
| `--dry-run` | Build plan without writing |
| `--json` | Structured output for agents |
| `--yes` | Apply without interactive confirm |
| `--plan` | Write plan to `.forge/refactors/` |
| `--no-generate` | Skip auto-generate after apply |
| `--no-verify` | Skip verify after apply |
| `--allow-high-risk` | Allow high-risk plans |

Plans are stored under `.forge/refactors/` with snapshots for rollback.

## AST-aware codemods

These codemods use the TypeScript compiler API for precise rewrites:

| Codemod | AST-aware | Notes |
|---------|-----------|-------|
| `extract-action` | Yes | Binding-aware; preserves type-only imports |
| `rename field` | Yes | Scoped to target table |
| `rename table` | Yes | Updates data graph references |
| `rename command/query/action/...` | Yes | Renames export, file, `api.commands.*`, hooks, raw fetch paths |
| `rename policy` | Partial | Name substitution |
| `rename event` | Partial | String substitution in scoped files |
| `replace-process-env` | Text-based | Rewrites to `ctx.secrets` |
| `replace-import` | Text-based | Module path substitution |

Never edit `src/forge/_generated/**` directly. Codemods list affected generated artifacts in the impact report.

## rename field

Renames a column within a single table. References are scoped so generic UI code is not corrupted.

```bash
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --yes
```

Requirements:

- Syntax: `<table.field> <table.field>` — both sides must share the same table name.
- Example valid: `tickets.priority` → `tickets.urgency`
- Example invalid: `tickets.priority` → `issues.urgency` (different tables)

Impact includes:

- Schema / data graph fields
- Policies referencing the field
- Frontend bindings linked to the table
- Blueprints and tests when enabled

Review migration hints in the plan before applying. Field renames may require database migrations outside Forge.

## rename table

Renames a table and propagates references across runtime and frontend surfaces.

```bash
forge refactor rename table tickets issues --dry-run --json
forge refactor rename table tickets issues --yes
```

Impact includes:

- Data graph table map
- Policy and RLS metadata
- Commands/queries referencing `ctx.db.<table>`
- Frontend capability map entries

High risk when production data exists — always dry-run first.

## rename command (and other runtime entries)

Renames a command, query, liveQuery, action, or workflow with **AST-aware** updates across backend and frontend wiring tracked by the capability map.

```bash
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename command createTicket openTicket --yes
```

### What gets rewritten

| Surface | Example before | Example after |
|---------|----------------|---------------|
| Command export | `export const createTicket = command(...)` | `export const openTicket = command(...)` |
| Command file | `src/commands/createTicket.ts` | `src/commands/openTicket.ts` |
| Generated API hook usage | `useCommand(api.commands.createTicket)` | `useCommand(api.commands.openTicket)` |
| String hook usage | `useCommand("createTicket")` | `useCommand("openTicket")` |
| Raw runtime fetch | `fetch("/commands/createTicket")` | `fetch("/commands/openTicket")` |
| Blueprint JSON | `"command": "createTicket"` | `"command": "openTicket"` |
| Import paths | `../commands/createTicket.js` | `../commands/openTicket.js` |

### What stays unchanged

- Unrelated identifiers with the same spelling (local variables, UI labels)
- Generated files under `src/forge/_generated/**` (regenerate after apply)
- Policy names unless you rename them separately

After applying:

```bash
forge generate
forge inspect capabilities --json
forge verify --standard
```

The same semantic rules apply to `rename query`, `rename livequery`, `rename action`, and `rename workflow`.

## extract-action

Moves a forbidden package import out of a **command** into a new **action** subscribed to an outbox event. This is the primary fix for `FORGE_GUARD_VIOLATION` when network code was placed in a command.

```bash
forge refactor extract-action createInvoice \
  --package stripe \
  --event invoice.requested \
  --action createInvoiceStripe \
  --dry-run --json

forge refactor extract-action createInvoice \
  --package stripe \
  --yes
```

| Option | Default | Meaning |
|--------|---------|---------|
| `--package` | required | npm package name to extract (e.g. `stripe`) |
| `--event` | `<command>.requested` | Outbox event name |
| `--action` | `<command>Action` | New action file name |

### What the codemod does

1. Finds `export const <command> = command({ handler: ... })` in `src/commands/`.
2. Requires a **block body** handler: `async (ctx, input) => { ... }`.
3. Removes the **value import** of the package from the command file (type-only imports stay).
4. Blocks **side-effect imports** (`import "stripe"`) — extract manually first.
5. Creates `src/actions/<actionName>.ts` subscribed to the event.
6. Rewrites the command handler to **`ctx.emit(event, payload)`** instead of calling the SDK.

The generated action includes a placeholder handler that references the package namespace — **you must fill in the real SDK logic** after extraction.

### Requirements and failures

| Error | Cause |
|-------|-------|
| `FORGE_REFACTOR_TARGET_NOT_FOUND` | Command file not found |
| `FORGE_REFACTOR_PATCH_UNSAFE` | Handler not a block arrow/function |
| `FORGE_REFACTOR_TARGET_NOT_FOUND` | Package import not found in command file |
| Side-effect import diagnostic | `import "pkg"` cannot be auto-split |

Command shape must match:

```typescript
export const myCommand = command({
  handler: async (ctx, input) => {
    // block body required
  },
});
```

Not supported for extract-action:

- Expression-bodied handlers: `handler: async () => stripe()`
- SDK usage spread across helper files without a direct import in the command file

### End-to-end example

Before (fails `forge check`):

```typescript
import Stripe from "stripe";
import { command } from "forge/server";

export const charge = command({
  handler: async (ctx, input) => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    return stripe.charges.create({ amount: input.amount });
  },
});
```

After extract-action + manual action edit:

```typescript
// src/commands/charge.ts
export const charge = command({
  handler: async (ctx, input) => {
    await ctx.emit("charge.requested", { amount: input.amount });
    return { queued: true };
  },
});

// src/actions/chargeAction.ts
import { action } from "forge/server";
import { createStripeClient } from "../forge/_generated/packages/stripe.server.js";

export const chargeAction = action({
  event: "charge.requested",
  handler: async (ctx, event) => {
    const stripe = createStripeClient(ctx.secrets);
    return stripe.paymentIntents.create({ amount: event.amount });
  },
});
```

Then:

```bash
forge generate
forge check --json
forge verify --standard
```

## replace-process-env

Rewrites direct `process.env.MY_VAR` usage toward `ctx.secrets` patterns. Use after adding secrets to the registry.

```bash
forge refactor replace-process-env STRIPE_SECRET_KEY --dry-run --json
```

Prefer generated adapters (`createStripeClient(ctx.secrets)`) over raw secret access when a recipe exists.

## replace-import

Substitutes module specifiers project-wide (text-based).

```bash
forge refactor replace-import ../lib/oldClient.js ../lib/newClient.js --dry-run --json
```

Review the plan — this codemod is not AST-aware.

## rename runtime entries

Rename commands, queries, liveQueries, actions, workflows, policies, or events:

```bash
forge refactor rename command oldName newName --dry-run --json
forge refactor rename event ticket.created ticket.opened --dry-run --json
```

Targets: `table`, `field`, `policy`, `command`, `query`, `livequery`, `action`, `workflow`, `event`.

Impact reports list API surface, client bindings, tests, and generated artifacts.

## move component

Move a frontend component file:

```bash
forge refactor move component TicketList web/components/TicketList --dry-run --json
```

## Plan, apply, rollback workflow

```bash
# 1. Plan
forge refactor rename field notes.status notes.state --dry-run --json

# 2. Apply (uses plan id from output)
forge refactor apply <plan-id> --yes

# 3. Rollback if needed
forge refactor rollback <plan-id>
```

Applied refactors trigger `forge generate` and optionally `forge verify` unless disabled.

## Agent checklist

1. Run `forge refactor ... --dry-run --json`.
2. Read `impact.generatedArtifacts` and `impact.runtime`.
3. Apply with `--yes` only when risk is acceptable.
4. Run `forge generate --check`.
5. Run `forge verify --standard` (or `--strict` for handoff).

## Related pages

- [Payments](payments.md) — why side effects belong in actions
- [forge add](forge-add.md) — generated adapters after add
- [Troubleshooting](troubleshooting.md) — guard violations and repair
- [Runtime Model](runtime-model.md) — command constraints
