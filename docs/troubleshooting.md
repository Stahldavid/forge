# Troubleshooting

This guide covers the most common ForgeOS failures during local development, CI, and agent-driven edits. Forge diagnostics are designed to be **machine-readable** — prefer `--json` flags when debugging with agents.

## First response checklist

When something fails, run this sequence:

```bash
forge dev --once --json
forge doctor
forge generate --check
forge check --json
forge verify --standard --json
```

For Windows-specific path and shell issues:

```bash
forge doctor windows --json
forge setup windows --yes
```

## Diagnostic commands

| Command | Use when |
|---------|----------|
| `forge dev --once --json` | Single-pass snapshot: drift, routes, doctor, impact |
| `forge doctor` | Missing contract files, stale generated output |
| `forge check --json` | Guard violations, secret rules, AI/query usage |
| `forge inspect all --json` | Deep project understanding |
| `forge inspect frontend --json` | Route/binding/capability-map issues |
| `forge inspect runtime-matrix --json` | Package context compatibility |
| `forge repair diagnose --json` | Structured failure analysis |
| `forge telemetry inspect <traceId>` | Policy/runtime errors with trace id |

Human-readable playbooks also live in:

- `AGENTS.md`
- `src/forge/_generated/operationPlaybooks.md`

## Stale generated artifacts

**Symptom:** `forge doctor` reports `generated artifacts are stale`, or `forge generate --check` fails.

**Cause:** Source changed but `_generated/` or `forge.lock` was not regenerated.

**Fix:**

```bash
forge generate
forge generate --check   # confirm clean
git status               # review generated changes
```

Template apps often gitignore `_generated/` — run `forge generate` after clone before verify.

## FORGE_GUARD_VIOLATION

**Symptom:** `forge check` error like:

```text
'stripe' is not allowed in 'command' context
```

**Cause:** A package import violates the runtime matrix (network SDK in a command, query, or liveQuery).

**Fix options:**

1. **Move logic to an action** (recommended) — see [Payments](payments.md).
2. **Run extract-action codemod** — see [Codemods](codemods.md).
3. **Use type-only imports** in commands when you only need types:

   ```typescript
   import type Stripe from "stripe"; // allowed
   ```

4. **Inspect matrix** to confirm allowed contexts:

   ```bash
   forge inspect runtime-matrix --json
   forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json
   ```

Common mistakes:

| Mistake | Fix |
|---------|-----|
| Stripe/Payment SDK in command | Action + `ctx.emit` |
| `process.env.STRIPE_SECRET_KEY` in app code | `ctx.secrets` or generated adapter |
| PostHog server SDK in query | Move to action or server module |
| Importing action code into command | Keep dependency direction command → emit only |

## Secret errors

**Symptom:** Missing secret diagnostics, auth failures, or `--strict-secrets` check failures.

**Fix:**

```bash
forge inspect secrets --json
```

- Add values to `.env` (local) or deployment secret store (production).
- Register secret names in config; never commit values.
- After `forge add stripe`, expect `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.

Run strict check:

```bash
forge check --strict-secrets --json
```

## forge add failures

| failureKind | Meaning | Fix |
|-------------|---------|-----|
| `unknown_alias` | Unsupported `forge add` target | Use `stripe`, `posthog`, `sentry`, `zod`, or `ai` |
| `install_failed` | npm install error | Check network, lockfile, permissions; try `--allow-scripts` |
| `lock_integrity` | `forge.lock` mismatch | `forge generate`, resolve merge conflicts |
| `write_failed` | Emit error | Permissions, disk space |

Always inspect JSON output:

```bash
forge add stripe --json
```

On failure, Forge restores version-controlled files from the pre-add snapshot.

## verify failures

**Symptom:** `forge verify --standard` or `--strict` exits non-zero.

**Steps:**

```bash
forge verify --standard --json
# Read steps[].failureKind and diagnostics[]

forge test run --changed --json
forge repair diagnose --from-last-test-run --json
```

Inspect last test output:

```text
.forge/test-runs/last.json
```

Skip flags (narrow debugging only):

```bash
forge verify --standard --skip-tests
forge verify --standard --skip-typecheck
```

For release handoff, fix root cause — do not skip gates permanently.

## Repair workflow

When checks fail, do not guess. Use the repair loop:

```bash
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
forge repair apply <repair-id> --yes   # high confidence only
forge verify --changed
forge verify --strict
```

`diagnose` returns:

- `failureKind` — category of failure
- `likelyCause` — human-readable explanation
- `suggestedRepairs` — ranked fixes with confidence
- `suggestedCommands` — CLI next steps

Apply only **high-confidence** repairs automatically. Review medium/low confidence changes manually.

Other diagnose sources:

```bash
forge repair diagnose --from-last-ui-run --json
forge repair diagnose --diagnostic FORGE_GUARD_VIOLATION --json
forge repair diagnose --trace <traceId> --json
forge repair diagnose --outbox-delivery <id> --json
```

## Outbox and worker issues

**Symptom:** Events emitted but side effects never run (emails, Stripe charges, etc.).

**Checks:**

```bash
forge dev                    # starts worker with local stack
forge worker --once          # process outbox manually
forge inspect subscriptions --json
```

Ensure:

1. Command called `await ctx.emit(...)` inside the handler.
2. Action subscribes to the same event name.
3. Worker is running in dev/production.
4. Database reachable (outbox tables `_forge_outbox`, `_forge_outbox_deliveries`).

## Frontend wiring issues

**Symptom:** Routes missing, capability-map warnings, dev auth problems.

```bash
forge dev --once --json
forge inspect frontend --json
forge inspect capabilities --json
```

Common issues:

| Issue | Hint |
|-------|------|
| `web/` exists but no frontend graph | Run `forge generate`; check `web/` layout |
| Missing bridge files | Template expects generated client bindings |
| devAuth tenantId warning | Use UUID-like tenant id when DB tenant columns are uuid |

## Policy and auth errors

**Symptom:** 403 responses, policy denial in UI.

```bash
forge policy simulate <policyName> --role <role> --json
forge telemetry inspect <traceId>
```

Capture `traceId` from API response or browser network tab.

Production uses JWT/OIDC; local dev may use `dev-headers` mode. See runtime auth config in generated `authConfig.json`.

## Windows-specific issues

```bash
forge doctor windows --json
forge setup windows --yes --json
```

Typical fixes:

- Bun/Node path resolution
- `.cmd` shim spawning (field tests and subprocess CLI)
- Line endings and lockfile tooling

CI runs multi-OS matrix (ubuntu, windows, macos) on Node 22 and 24.

## Generated drift in CI

**Symptom:** CI fails on `forge generate --check` or external quickstart job.

**Fix locally:**

```bash
forge generate
git diff src/forge/_generated/
```

Commit regenerated artifacts if your project tracks them, or ensure CI runs generate before check (template apps often ignore `_generated/` in git).

## npm / field test failures

When validating the published package:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --json
```

See [Field Testing](field-testing.md) for the full matrix workflow.

## Error code reference

| Code | Area | Typical fix |
|------|------|-------------|
| `FORGE_GUARD_VIOLATION` | Import guards | Move code to action; extract-action |
| `FORGE_UNKNOWN_ALIAS` | forge add | Use supported alias |
| `FORGE_ADD_INSTALL_FAILED` | forge add | Fix npm install |
| `FORGE_LOCK_INTEGRITY` | generate/add | Regenerate; fix lock conflicts |
| `FORGE_REFACTOR_PATCH_UNSAFE` | codemod | Adjust source shape; dry-run again |
| `FORGE_REFACTOR_TARGET_NOT_FOUND` | codemod | Check names/paths |
| `FORGE_VERIFY_TESTS` | verify | `forge test run`; repair diagnose |
| `FORGE_DRY_RUN_FALLBACK` | forge add dry-run | Informational; plan still returned |

Full diagnostic codes appear in CLI JSON under `errors[].code` with `fixHint` and `suggestedCommands`.

## Escalation path

1. `forge dev --once --json` — collect snapshot
2. `forge repair diagnose ... --json` — structured analysis
3. `forge inspect all --json` — full contract review
4. `forge verify --strict` — confirm fix before handoff

For framework bugs, include JSON output and steps to reproduce when opening an issue on the repository.

## Related pages

- [Getting Started](getting-started.md)
- [CLI](cli.md)
- [forge add](forge-add.md)
- [Codemods](codemods.md)
- [Payments](payments.md)
- [Field Testing](field-testing.md)
