# forge add

`forge add` is the supported way to integrate npm packages into a Forge app. It installs dependencies, analyzes their public API, classifies runtime capabilities, and emits generated adapters, integration helpers, testkits, and documentation under `src/forge/_generated/`.

Prefer `forge add` over manual `npm install` so the compiler can build the **runtime matrix**, **import guards**, and **secret registry** consistently.

This is one of the main ForgeOS workflows. A package install is where agents often break apps: wrong SDK call, missing secret, unsafe runtime import, no mock, no generated docs, or no verification path. `forge add` turns integration setup into a deterministic compiler input that agents and humans can inspect.

## Packages and recipes

`forge add` accepts both npm package specs and Forge integration recipes.

Use a regular package name when you only need a dependency:

```bash
forge add lucide-react --workspace web
forge add frontend:lucide-react
forge add hono --backend
forge add date-fns
forge add package zod
```

Use an integration recipe when Forge should install packages and emit adapters, secrets, docs, and testkits:

```bash
forge add stripe
forge add integration stripe
```

When a target matches a known recipe, the bare form keeps the recipe behavior for compatibility. Use `forge add package <spec>` to force a normal npm package install for a name that also has a recipe.

Frontend/backend package targets are normal npm package installs with clearer intent:

- `forge add frontend:<package>` or `forge add <package> --frontend` installs into the detected frontend package directory (`web`, `frontend`, `client`, `apps/web`, or `packages/web`).
- `forge add backend:<package>` or `forge add <package> --backend` installs into the Forge app root package.
- `--workspace <path>` is still the most explicit form and wins when you need a specific package directory.

Top-level recipe aliases:

| Alias | npm package(s) | Typical use |
|-------|----------------|-------------|
| `stripe` | `stripe` | Payments, billing, webhooks |
| `posthog` | `posthog-js`, `posthog-node` | Product analytics (client + server split) |
| `sentry` | `@sentry/nextjs`, `@sentry/node`, `@sentry/browser` | Error monitoring |
| `zod` | `zod` | Shared validation schemas |
| `ai` | `ai` | AI SDK core (server/action/workflow) |

AI provider aliases are also available (for example `ai-provider-openai`, `ai-provider-anthropic`, `ai-gateway`). These resolve through the recipe registry but are typically added via their package names after `forge add ai`.

Unknown explicit integration aliases fail with `FORGE_UNKNOWN_ALIAS`:

```bash
forge add integration unknown-vendor
# supported: stripe, posthog, sentry, zod, ai
```

## Basic workflow

```bash
forge add stripe --dry-run --json
forge add stripe
forge add lucide-react --workspace web
forge generate
forge check --json
forge verify --standard
```

Recommended order:

1. **`forge add <package>`** — install a normal npm package and refresh generated package evidence.
2. **`forge add <alias>`** — when the target is a known recipe, install package(s) and emit integration artifacts.
3. **`forge generate`** — refresh the full generated contract if other sources changed.
4. **`forge check`** — run guardrails (import guards, secret usage, AI/query rules).
5. **`forge verify --standard`** — run the normal development gate.

## Flags

| Flag | Purpose |
|------|---------|
| `--dry-run` | Plan files and diagnostics without writing or installing |
| `--json` | Machine-readable output for agents and CI |
| `--runtime-inspect` | Run deeper package analysis (slower; optional) |
| `--sandbox-backend <mode>` | Sandbox backend for runtime inspection |
| `--allow-scripts` | Allow package install scripts (default: scripts disabled) |
| `--workspace <path>` | Install a normal package in that package directory, such as `web/package.json` |
| `--frontend` | Install a normal package into the detected frontend package directory |
| `--backend` | Install a normal package into the Forge app root package |

Example dry run:

```bash
forge add stripe --dry-run --json
forge add lucide-react --workspace web --dry-run --json
forge add frontend:lucide-react --dry-run --json
forge add hono --backend --dry-run --json
```

The JSON response includes `mode`, `targetKind`, `target`, `explanation`, `changed`, `warnings`, `errors`, and `failureKind` when applicable. `targetKind` is `npm-package` for normal package installs and `forge-integration` for recipe-backed integrations, so Studio and external agents can explain what will happen without inferring it from filenames. For normal npm packages it also includes `packageSpec`, `packageName`, `packageTarget`, `packageTargetReason`, `packageManager`, `installCommand`, `nativeInstallCommand`, `avoidedManualCommand`, `installCwd`, optional `installWorkspace`, and package-oriented `nextActions` such as `forge deps inspect <package> --json`, `forge generate`, and `forge check --json`. `packageSpec` preserves the exact install request, such as `@tanstack/react-query@latest`; `packageName` strips the version/range and is what Forge uses for `forge deps inspect`. With `--workspace web` or `frontend:<package>`, `installCwd` is the resolved frontend directory and `installWorkspace` records the semantic target; Forge does not require npm/pnpm/yarn workspace metadata just to add a frontend package. `avoidedManualCommand` shows the native package-manager command Forge is managing so users do not need to run `npm install`, `bun add`, `pnpm add`, or `yarn add` separately. For recipe-backed integrations it includes `recipeVersion`, `recipePackages`, `requiredSecrets`, `optionalSecrets`, and integration-oriented `nextActions` such as `forge deps inspect <package> --json` and `forge secrets check --json`. This lets an external code agent show the exact install or integration plan before mutating `package.json`.

Human output prints the same normal-package essentials: package spec, normalized package name when different, target, package target, target reason, install cwd, install workspace, install command, avoided manual command, and the same `Next:` commands returned by JSON.

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

## Dependency API for agents

After `forge add` and `forge generate`, Forge builds a **PackageGraph** with export signatures, JSDoc, resolution traces, and runtime compatibility metadata. Use the dependency CLI when an AI coding agent or human needs to call a vendor SDK safely without reading all of `node_modules`.

This layer resolves what the package exposes, summarizes the useful API surface, and connects that evidence to runtime placement. The goal is not to mirror package docs. The goal is to give agents enough local proof to write correct code and then let `forge check` enforce context rules.

### Inspect a package

```bash
forge deps inspect stripe --json
```

Returns package version, classified contexts, export summary, and diagnostics.
Versioned specs are accepted for convenience; `forge deps inspect @tanstack/react-query@latest --json` normalizes to package `@tanstack/react-query` and preserves the original spec as `requestedPackageSpec` in JSON output. If the package is missing, diagnostics mention both the normalized package and the requested spec.

### Look up a symbol

```bash
forge deps api stripe checkout.sessions.create --json
```

Returns signatures, JSDoc, examples when available, and runtime placement hints. This is the fastest way for an agent to learn how to call a specific SDK method after `forge add stripe`.

### Trace resolution

```bash
forge deps trace stripe --json
```

Shows how Forge resolved the package entry points, subpath exports, and type entry files.

### Runtime compatibility

```bash
forge deps runtime-compat stripe --json
```

Reports which runtime contexts may import the package and any runtime/type mismatch warnings.

### Generated contract

Summaries also appear in:

- `src/forge/_generated/packageGraph.json`
- `src/forge/_generated/agentContract.json` → `dependencyApis`

Recommended agent workflow after adding a package:

```bash
forge add stripe --json
forge generate --check
forge deps api stripe <Symbol> --json
forge check --json
```

See [CLI - Dependency API oracle](cli.md#dependency-api-oracle-for-agents-and-upgrades).

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
- [AI](ai.md) — AI integration and agent tools
- [Codemods](codemods.md) — `extract-action` when guards fail
- [Troubleshooting](troubleshooting.md) — guard violations and repair flow
