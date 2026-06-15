# Recipes

A **recipe** is Forge's declarative integration contract for an npm package or vendor. Recipes tell the compiler which runtime contexts are safe, which secrets are required, which network egress is expected, and which generated files to emit.

Recipes live in the Forge framework repository (`src/forge/compiler/recipes/definitions.ts`). App projects consume them through `forge add <alias>`.

## Recipe structure

Each `IntegrationRecipe` includes:

| Field | Meaning |
|-------|---------|
| `alias` | CLI name for `forge add` |
| `packages` | npm package name(s); may include `role` (`client`, `server`, `framework`, `provider`) |
| `supportedVersionRange` | semver range validated at add time |
| `recipeVersion` | Recipe schema/generation version |
| `contexts.allowed` / `contexts.denied` | Default runtime contexts |
| `capabilities` | Network egress, filesystem, process, native addons |
| `secrets` | Env var names registered in `secretRegistry` |
| `adapters` | Generated wrapper modules under `packages/` |
| `integrations` | Helpers under `integrations/` (webhooks, events, flags) |
| `testkits` | Mock modules for tests |
| `docs` | Agent-readable markdown under `_generated/docs/` |

Per-package context overrides are supported when a recipe ships multiple packages (PostHog client vs server, Sentry browser vs node).

## Reference catalog

### stripe

```text
Alias:          stripe
Package:        stripe (>=17.0.0)
Recipe version: 2.0.0
```

| Context | Allowed |
|---------|---------|
| `server`, `action`, `workflow`, `endpoint` | Yes |
| `command`, `query`, `liveQuery`, `client`, `shared` | No |

| Secret | Required |
|--------|----------|
| `STRIPE_SECRET_KEY` | Yes |
| `STRIPE_WEBHOOK_SECRET` | Yes |

| Network egress | `api.stripe.com` |

Generated artifacts:

- `packages/stripe.server.ts` — `createStripeClient(secrets)`
- `packages/stripe.workflow.ts` — workflow client
- `integrations/stripe/webhook.ts` — `constructStripeWebhookEvent(...)`
- `testkits/stripe.mock.ts`
- `docs/stripe.md`

### posthog

```text
Alias:          posthog
Packages:       posthog-js (client), posthog-node (server)
Recipe version: 2.0.0
```

Split client/server contexts:

- **posthog-js** — `client`, `shared`, `test`, `build`
- **posthog-node** — `server`, `action`, `workflow`, `endpoint`

Secrets: `NEXT_PUBLIC_POSTHOG_KEY`, `POSTHOG_KEY`, optional `POSTHOG_HOST`.

Integrations: `posthog/events.ts`, `posthog/flags.ts`.

### sentry

```text
Alias:          sentry
Packages:       @sentry/nextjs, @sentry/node, @sentry/browser
Recipe version: 2.0.0
Framework:      nextjs (when using @sentry/nextjs)
```

Secrets: `SENTRY_DSN`, optional `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`.

Integrations: errors, releases, sourcemaps helpers.

### zod

```text
Alias:          zod
Package:        zod (>=3.0.0)
Recipe version: 2.0.0
```

Zod is allowed in **all** runtime contexts — ideal for shared input schemas between commands, queries, and the frontend.

Generated: `packages/zod.shared.ts`, `testkits/zod.mock.ts`.

### ai

```text
Alias:          ai
Package:        ai (>=5.0.0)
Recipe version: 2.0.0
```

Allowed: `server`, `action`, `workflow`, `endpoint`, `test`, `build`.

Denied: `command`, `query`, `liveQuery`, `client`, `shared`, `edge`.

Secrets: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, optional `AI_GATEWAY_API_KEY`.

Network egress is provider-dependent; provider packages are classified separately.

Provider sub-recipes:

| Alias | Package | Egress |
|-------|---------|--------|
| `ai-provider-openai` | `@ai-sdk/openai` | `api.openai.com` |
| `ai-provider-anthropic` | `@ai-sdk/anthropic` | `api.anthropic.com` |
| `ai-gateway` | `ai` (gateway role) | `gateway.ai.vercel.dev` |

### forge

Internal recipe for the `forge` package itself. Used when analyzing framework imports inside generated apps.

## Runtime matrix

After `forge add`, inspect compatibility:

```bash
forge inspect runtime-matrix --json
```

Each matrix entry includes:

- `compatible` / `incompatible` contexts
- `capabilities.network.egress` hostnames
- `capabilities.secrets` with `envVar` and `required`
- `rationale` explaining why a context is denied

Example rationale for Stripe in a command:

```text
'stripe' is not allowed in 'command' context — package is incompatible with this runtime context
```

## Import guards

`forge check` evaluates direct and transitive package imports against the runtime matrix. Violations emit `FORGE_GUARD_VIOLATION` with file, package, context, and fix hints.

Guards propagate context through the module graph: importing a command file from an action does not magically allow Stripe in the command — the command file still carries the `command` context.

## What recipes do not do

Recipes are **not**:

- OpenAPI/REST catalogs of vendor HTTP APIs
- Auto-generated CRUD for payments or analytics
- Replacements for reading vendor SDK documentation

They **are**:

- Safety boundaries for agent-edited code
- Generated adapter scaffolding
- Secret and egress registration for deployment review
- Testkit stubs for local verification

## Adding a new recipe (framework contributors)

New vendor support requires a recipe in `definitions.ts`, template renderers under `src/forge/compiler/integration/templates/`, registry entry in `registry.ts`, and tests in `tests/integration/`.

Until a recipe exists, apps should use the manual integration pattern described in [Payments](payments.md).

## Related pages

- [forge add](forge-add.md) — CLI workflow and flags
- [Payments](payments.md) — end-to-end payment flows
- [Codemods](codemods.md) — moving forbidden imports out of commands
- [Troubleshooting](troubleshooting.md) — guard and secret errors
