# forge add

`forge add` is the supported way to integrate npm packages into a Forge app. It installs dependencies, analyzes their public API, classifies runtime capabilities, and emits generated adapters, integration helpers, testkits, and documentation under `src/forge/_generated/`.

Prefer `forge add` over manual `npm install` so the compiler can build the **runtime matrix**, **import guards**, and **secret registry** consistently.

## Supported aliases

Top-level CLI aliases (reference integrations):

| Alias | npm package(s) | Typical use |
|-------|----------------|-------------|
| `stripe` | `stripe` | Payments, billing, webhooks |
| `posthog` | `posthog-js`, `posthog-node` | Product analytics (client + server split) |
| `sentry` | `@sentry/nextjs`, `@sentry/node`, `@sentry/browser` | Error monitoring |
| `zod` | `zod` | Shared validation schemas |
| `ai` | `ai` | AI SDK core (server/action/workflow) |

AI provider aliases are also available (for example `ai-provider-openai`, `ai-provider-anthropic`, `ai-gateway`). These resolve through the recipe registry but are typically added via their package names after `forge add ai`.

Unknown aliases fail with `FORGE_UNKNOWN_ALIAS`:

```bash
forge add unknown-vendor
# supported: stripe, posthog, sentry, zod, ai
```

## Basic workflow

```bash
forge add stripe --dry-run --json
forge add stripe
forge generate
forge check --json
forge verify --standard
```

Recommended order:

1. **`forge add <alias>`** — install package(s) and emit integration artifacts.
2. **`forge generate`** — refresh the full generated contract if other sources changed.
3. **`forge check`** — run guardrails (import guards, secret usage, AI/query rules).
4. **`forge verify --standard`** — run the normal development gate.

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Plan files and diagnostics without writing or installing |
| `--json` | Machine-readable output for agents and CI |
| `--runtime-inspect` | Run deeper package analysis (slower; optional) |
| `--sandbox-backend <mode>` | Sandbox backend for runtime inspection |
| `--allow-scripts` | Allow package install scripts (default: scripts disabled) |

Example dry run:

```bash
forge add stripe --dry-run --json
```

The JSON response includes `changed`, `warnings`, `errors`, and `failureKind` when applicable.

## What gets generated

For `forge add stripe`, Forge emits:

| Artifact | Purpose |
|----------|---------|
| `src/forge/_generated/packages/stripe.server.ts` | Server/action client factory using `ctx.secrets` |
| `src/forge/_generated/packages/stripe.workflow.ts` | Workflow-safe client |
| `src/forge/_generated/integrations/stripe/webhook.ts` | Webhook signature verification helper |
| `src/forge/_generated/testkits/stripe.mock.ts` | Mock client for tests |
| `src/forge/_generated/docs/stripe.md` | Integration notes for agents |
| Updated `runtimeMatrix.json` | Per-context compatibility and egress rules |
| Updated `importGuards.json` | Enforcement metadata for `forge check` |
| Updated `secretRegistry.json` | Required secret names (never values) |
| Updated `forge.lock` | Lock integrity for reproducible generation |

Inspect the result:

```bash
forge inspect packages --json
forge inspect runtime-matrix --json
forge inspect secrets --json
```

## How classification works

`forge add` does **not** catalog every HTTP endpoint of a vendor SDK. Instead it:

1. **Installs** the npm package(s) defined by the recipe.
2. **Analyzes** exports, signatures, and JSDoc via the PackageGraph compiler.
3. **Applies the recipe** — allowed/denied runtime contexts, network egress, secrets.
4. **Classifies** capabilities (network, secrets, filesystem, native addons, etc.).
5. **Emits adapters** that wrap secret access and document safe usage.

Parameter mistakes are caught by **TypeScript** when you call the SDK. Context mistakes (for example Stripe inside a command) are caught by **`forge check`** as `FORGE_GUARD_VIOLATION`.

## Runtime contexts

Forge assigns each source file an effective runtime context (`command`, `query`, `action`, `workflow`, `endpoint`, `client`, etc.). Packages are compatible only in contexts listed in the runtime matrix.

Common pattern for network integrations:

| Context | Stripe | PostHog server | Zod |
|---------|--------|----------------|-----|
| `command` | Denied | Denied | Allowed |
| `query` / `liveQuery` | Denied | Denied | Allowed |
| `action` / `workflow` / `endpoint` | Allowed | Allowed | Allowed |
| `client` | Denied | Client package only | Allowed |

Type-only imports are allowed in restricted contexts:

```typescript
import type Stripe from "stripe"; // OK in a command file
import Stripe from "stripe";       // FORGE_GUARD_VIOLATION in a command
```

## Secrets

Recipes declare secret **names**, not values. After `forge add stripe`, configure:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Use `ctx.secrets.get("STRIPE_SECRET_KEY")` in actions/workflows/endpoints via the generated adapter — never `process.env` in app code.

List required secrets:

```bash
forge inspect secrets --json
```

## Failure kinds

| failureKind | Typical cause | Fix |
|-------------|---------------|-----|
| `unknown_alias` | Typo or unsupported vendor | Use a supported alias or integrate manually |
| `install_failed` | npm/network/permission error | Fix package manager, retry with `--allow-scripts` if needed |
| `write_failed` | Could not emit generated files | Check permissions, disk space |
| `lock_integrity` | `forge.lock` out of sync | Run `forge generate`, review VCS conflicts |

On failure during a real (non-dry-run) add, Forge restores a snapshot of version-controlled files.

## Manual installs

Avoid `npm install stripe` unless you have a deliberate architecture exception. Manual installs skip recipe metadata, adapters, and consistent guard rules.

If a package has no recipe (for example Asaas or e.rede), see [Payments](payments.md) for the recommended command → emit → action pattern.

## Agent workflow

When an AI agent adds an integration:

```bash
forge add stripe --dry-run --json
forge add stripe --json
forge generate --check
forge check --json
forge inspect runtime-matrix --json
```

Read the generated doc at `src/forge/_generated/docs/stripe.md` before writing actions or endpoints.

## Related pages

- [Recipes](recipes.md) — recipe schema and catalog
- [Payments](payments.md) — Stripe and manual payment providers
- [Codemods](codemods.md) — `extract-action` when guards fail
- [Troubleshooting](troubleshooting.md) — guard violations and repair flow
