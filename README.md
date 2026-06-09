# Forge Compiler

Deterministic codegen compiler for Forge apps. Parses Forge builder APIs, analyzes package integrations statically, classifies runtime contexts, and emits `src/forge/_generated/` plus `forge.lock`.

**Status:** MVP compiler implementation complete. Needs hardening before public release.

## Quickstart

```bash
bun install --ignore-scripts
bun run typecheck
bun test
bun run forge generate
bun run forge verify
```

## CLI

| Command | Description |
|---------|-------------|
| `forge generate` | Analyze workspace and emit generated files |
| `forge generate --check` | Fail on drift without writing |
| `forge add <alias>` | Add a reference integration (`stripe`, `posthog`, `sentry`, `zod`, `ai`) |
| `forge inspect <target>` | Inspect generated app/packages/runtime-matrix/data/runtime |
| `forge run [name]` | List or execute local command/action handlers (`--list`, `--mock`) |
| `forge check` | Validate transitive import guards |
| `forge verify` | CI/dogfood aggregator (`generate --check`, `forge check`, typecheck, tests, guard lint) |

Flags: `--json`, `--dry-run`, `--skip-tests`, `--skip-typecheck`, `--skip-eslint`.

## Example app

See [`examples/basic-forge-app`](examples/basic-forge-app/README.md) for a minimal app with:

- Zod in a `command` (allowed)
- Stripe in an `action` (allowed)
- Stripe transitively in a `command` (`FORGE_GUARD_VIOLATION`)

```bash
cd examples/basic-forge-app
bun run setup
bun run forge:generate
bun run forge:check
```

## Platform support

| Platform | Support |
|----------|---------|
| Linux | Supported |
| macOS | Supported |
| Windows (native) | Experimental — use WSL for MVP |
| Windows (WSL) | Supported |

### Known issues

1. **tree-sitter native postinstall** — On some Windows setups, `bun install` fails on the native `tree-sitter` postinstall script. Use:

   ```bash
   bun install --ignore-scripts
   ```

   The compiler requires Bun (uses `Bun.CryptoHasher` and tree-sitter). Track: evaluate `web-tree-sitter` backend to avoid native postinstall problems.

2. **`bun` PATH on Windows** — Ensure Bun is on your PATH, or invoke it by full path.

## CI

GitHub Actions runs:

```bash
bun install --ignore-scripts
bun run typecheck
bun test
bun run forge generate
bun run forge verify --skip-tests
# example app setup + generate --check
```

## Optional smoke tests (real network installs)

```bash
FORGE_SMOKE_REAL=1 bun test tests/smoke --timeout 120000
```

## Roadmap

1. **H1** — Hardening, CI, examples ✅
2. **H2** — Reference integration quality (recipe v2 templates) ✅
3. **H3** — DataGraph Compiler ✅
4. **H4** — Local command/action runtime (`forge run`, runtimeGraph, mocks) ✅
5. Runtime server, `forge dev`, workflows

### H4 deliverables (local runtime)

| Artifact | Description |
|----------|-------------|
| `runtimeGraph.json` | Command/action entries with module linkage |
| `runtimeRegistry.ts` | Name → handler metadata map |
| `mockMap.ts` | Package → testkit path for `--mock` runs |
| `forge run` | Execute handlers locally with guard preflight |

```bash
forge run --list
forge run createTicket
forge run createTicket --mock
```

### H3 deliverables (DataGraph)

- `dataGraph.json` / `dataGraph.ts` — schema.table extraction from AppGraph

### H2 deliverables (recipe v2.0.0)

| Integration | Generated artifacts |
|-------------|---------------------|
| **zod** | `zod.shared.ts` with real `z` re-export |
| **stripe** | `stripe.server.ts`, `stripe.workflow.ts`, `integrations/stripe/webhook.ts`, `stripe.mock.ts` |
| **posthog** | client/server adapters, `integrations/posthog/events.ts`, `flags.ts` |
| **sentry** | Next.js-target adapters, `errors.ts`, `releases.ts`, `sourcemaps.ts` |
| **ai** | `ai.server.ts`, `generations.ts`, `evals.ts`, OpenAI/Anthropic provider modules |
