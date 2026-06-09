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
| `forge inspect <target>` | Inspect generated app/packages/runtime-matrix |
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

1. **H1** — Hardening, CI, examples (this phase)
2. **H2** — Reference integration quality (stripe, posthog, sentry, zod, ai)
3. **H3** — DataGraph Compiler
4. Runtime, `forge dev`, workflows
