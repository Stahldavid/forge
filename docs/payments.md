# Payments

ForgeOS separates **transactional intent** (commands) from **side effects** (actions, workflows, endpoints). Payment integrations should follow this model: record what the user wants in the database, emit an event, then call the payment provider after commit.

This page covers the official **Stripe** recipe and the **manual pattern** for providers without a recipe (Asaas, e.rede, Mercado Pago, etc.).

## Architecture

```text
┌─────────────┐     ctx.db + ctx.emit      ┌──────────────┐
│   Command   │ ─────────────────────────► │ Outbox (tx)  │
│  (no network)│                            └──────┬───────┘
└─────────────┘                                   │ commit
                                                  ▼
                                           ┌──────────────┐
                                           │    Action    │
                                           │ (Stripe API) │
                                           └──────────────┘
                                                  │
                     webhook / callback           ▼
                                           ┌──────────────┐
                                           │   Endpoint   │
                                           │ verify + db  │
                                           └──────────────┘
```

| Layer | Allowed | Forbidden |
|-------|---------|-----------|
| Command | `ctx.db`, `ctx.emit`, buffered telemetry | Network, secrets, `ctx.ai`, `process.env` |
| Action / workflow | Network via adapters, `ctx.secrets` | Running inside the DB transaction |
| Endpoint | HTTP ingress, webhook verification | Business logic that should be durable steps |

See [Runtime Model](runtime-model.md) for the full rules.

## Stripe (official recipe)

### 1. Add Stripe

```bash
forge add stripe
forge generate
forge check --json
```

Configure secrets (names only in code; values in `.env`):

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 2. Create checkout intent in a command

The command persists local state and emits an event — it does **not** call Stripe.

```typescript
import { can, command } from "forge/server";

export const startCheckout = command({
  auth: can("billing.manage"),
  handler: async (ctx, input: { priceId: string }) => {
    const session = await ctx.db.checkoutSessions.insert({
      priceId: input.priceId,
      status: "pending",
    });

    await ctx.emit("checkout.requested", {
      sessionId: session.id,
      priceId: input.priceId,
    });

    return { sessionId: session.id };
  },
});
```

### 3. Call Stripe in an action

Use the generated server adapter in `src/actions/`:

```typescript
import { action } from "forge/server";
import { createStripeClient } from "../forge/_generated/packages/stripe.server.js";

export const createStripeCheckout = action({
  event: "checkout.requested",
  handler: async (ctx, event: { sessionId: string; priceId: string }) => {
    const stripe = createStripeClient(ctx.secrets);

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: event.priceId, quantity: 1 }],
      success_url: "https://app.example/success",
      cancel_url: "https://app.example/cancel",
      metadata: { sessionId: event.sessionId },
    });

    await ctx.db.checkoutSessions.update(event.sessionId, {
      stripeSessionId: checkoutSession.id,
      status: "created",
    });

    return { url: checkoutSession.url };
  },
});
```

### 4. Verify webhooks in an endpoint

Forge generates `integrations/stripe/webhook.ts`:

```typescript
import { createStripeClient } from "../forge/_generated/packages/stripe.server.js";
import { constructStripeWebhookEvent } from "../forge/_generated/integrations/stripe/webhook.js";

// In your HTTP endpoint handler:
const event = constructStripeWebhookEvent(rawBody, signatureHeader, ctx.secrets);

if (event.type === "checkout.session.completed") {
  const sessionId = event.data.object.metadata?.sessionId;
  // Update local DB, emit fulfillment events, etc.
}
```

### 5. Test locally

Use the generated mock:

```typescript
import { createStripeMock } from "../forge/_generated/testkits/stripe.mock.js";

const stripe = createStripeMock();
await stripe.checkout.sessions.create({});
```

Run the worker so actions process outbox events:

```bash
forge dev
# or separately:
forge worker --once
```

### Guard example

Importing Stripe in a command fails `forge check`:

```typescript
// src/commands/badExample.ts — intentionally invalid
import { stripe } from "../lib/stripeClient.js";

export const badStripeCommand = command(async () => {
  return stripe; // FORGE_GUARD_VIOLATION
});
```

Fix with [extract-action](codemods.md) or move the SDK call to an action manually.

## Manual providers (Asaas, e.rede, others)

There is **no official recipe** yet for Brazilian gateways or most regional PSPs. Use the same architecture:

1. **Command** — insert payment intent row, `ctx.emit("payment.requested", payload)`.
2. **Action** — HTTP call to provider API using `ctx.secrets.get("ASAAS_API_KEY")` (or equivalent).
3. **Endpoint** — receive provider webhook; verify signature if supported; update DB; emit `payment.confirmed`.

### Recommended project layout (manual)

```text
src/
  commands/
    createPayment.ts      # db + emit only
  actions/
    chargeAsaas.ts        # network + secrets
  endpoints/
    asaasWebhook.ts       # verify + db update
  lib/
    asaasClient.ts        # thin wrapper (import only from action/endpoint)
```

Register secrets in `forge.config.ts` or your env schema so `forge inspect secrets` lists them. Without a recipe, you must enforce context rules yourself — keep `asaasClient.ts` imported only from actions, workflows, or endpoints.

### Asaas sketch

```typescript
// command — no network
await ctx.db.payments.insert({ amount, status: "pending", provider: "asaas" });
await ctx.emit("payment.requested", { paymentId, amount, customerId });

// action — network allowed
const apiKey = ctx.secrets.get("ASAAS_API_KEY");
const response = await fetch("https://api.asaas.com/v3/payments", {
  method: "POST",
  headers: { access_token: apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({ /* ... */ }),
});

// endpoint — webhook
// Verify token/header per Asaas docs, then update payment row and emit payment.confirmed
```

### e.rede sketch

Same pattern: command records intent, action calls e.rede authorization API with `ctx.secrets`, endpoint handles notification URL callbacks.

Because there is no generated runtime matrix entry, run `forge check` after adding imports and confirm no accidental command/query usage.

## Idempotency and failure handling

Payment actions should be **idempotent** where the provider allows it (idempotency keys, unique metadata).

| Scenario | Approach |
|----------|----------|
| Action fails mid-flight | Outbox retries with backoff; inspect `.forge/` worker logs |
| Duplicate webhook | Key webhook events by provider id in DB before side effects |
| Partial DB update | Keep command transactional; action updates are post-commit |

Debug delivery issues:

```bash
forge repair diagnose --outbox-delivery <id> --json
forge inspect subscriptions --json
```

## Security checklist

- Never put API keys in commands, queries, or client bundles.
- Never use `process.env` in app source — use `ctx.secrets` or generated adapters.
- Verify webhook signatures before trusting payload body.
- Scope policies so only authorized roles can start checkout or refunds.
- Run `forge verify --strict` before release.

## Verification commands

```bash
forge add stripe
forge generate
forge check --json
forge inspect secrets --json
forge inspect runtime-matrix --json
forge verify --standard
```

## Related pages

- [Runtime Model](runtime-model.md) — commands vs actions
- [forge add](forge-add.md) — Stripe installation
- [Recipes](recipes.md) — recipe capabilities
- [Codemods](codemods.md) — extract Stripe from a command
- [Troubleshooting](troubleshooting.md) — guard violations and worker issues
