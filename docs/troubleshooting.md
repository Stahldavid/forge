# Troubleshooting

This guide covers the most common ForgeOS failures during local development, CI, and agent-driven edits. Forge diagnostics are designed to be **machine-readable** — prefer `--json` flags when debugging with agents.

## First response checklist

When something fails, run this sequence:

```bash
forge status --json
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
| `forge status --json` | Compact project health, handoff state, and next actions |
| `forge handoff --json` | Switching agents, resuming work, or creating a compact work brief |
| `forge dev --once --json` | Single-pass snapshot: drift, routes, doctor, impact |
| `forge doctor` | Missing contract files, stale generated output |
| `forge check --json` | Guard violations, secret rules, AI/query usage |
| `forge agent print-context --json` | Agent-facing generated context pack |
| `forge inspect all --json` | Compact aggregate inspection |
| `forge inspect all --full --json` | Deep project dump when compact context is not enough |
| `forge inspect frontend --json` | Route/binding/capability-map issues |
| `forge inspect runtime-matrix --json` | Package context compatibility |
| `forge repair diagnose --json` | Structured failure analysis |
| `forge telemetry inspect <traceId>` | Policy/runtime errors with trace id |

Human-readable playbooks also live in:

- `AGENTS.md`
- `src/forge/_generated/operationPlaybooks.md`

## Error map

| Symptom or code | First command | Likely fix |
|-----------------|---------------|------------|
| Generated files are stale | `forge generate --check` | Run `forge generate`, then review generated drift. |
| `FORGE_GUARD_VIOLATION` | `forge check --json` | Move network/secret/AI work to action, workflow, endpoint, or server code. |
| `FORGE_AI_FORBIDDEN_CONTEXT` | `forge ai check --json` | Move model calls out of command, query, or liveQuery. |
| `FORGE_POLICY_DENIED` | `forge policy simulate <policy> --role <role> --json` | Fix caller role, tenant scope, or policy declaration. |
| LiveQuery stale data | `forge live status --json` | Check durable invalidations, tenant dependencies, and worker health. |
| Frontend route not connected | `forge inspect capabilities --json` | Use generated hooks and the local `web/**/lib/forge.ts` bridge. |
| Windows app picker opens for Bun | `forge doctor windows --json` | Set a safe Bun path or use the Node CLI path. |
| Tests hang or run too long | `forge verify --standard --script-timeout-ms 120000 --json` | Use impact tests first; reserve strict verification for handoff. |
| Stale global `forge` in framework checkout | `node bin/forge.mjs status --json` | Use the source-tree entrypoint while maintaining ForgeOS; use global `forge` only for package smoke. |
| Codex hooks waiting for approval | `forge agent hooks status --target codex --json` | Approve the Codex Desktop hook prompt, continue a Codex session, then rerun status. |
| DeltaDB or PGlite busy | `forge delta status --json` | Wait for the owning pid/command or inspect `.forge/delta/delta.lock` before repair. |
| Studio preview points at Studio | `forge studio doctor . --preview-port 5174 --target codex --json` | Use the target app preview on `5174`; avoid self-preview on `5173`. |

## CLI entrypoint mismatch

**Symptom:** A ForgeOS maintainer command shows old help text, generated AGENTS mention unavailable commands, or `forge verify` behaves differently from the source tree.

**Cause:** The global `forge` binary can lag behind the framework checkout.

**Fix in generated apps:**

```bash
forge status --json
forge verify --smoke
```

**Fix in the ForgeOS framework checkout:**

```bash
node bin/forge.mjs status --json
node bin/forge.mjs verify framework
```

Use global `forge` from this repository only when intentionally validating the installed package path.

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

`forge verify` is app-scoped. It should not run ForgeOS framework tests in ordinary generated apps. Framework maintainers must opt into the internal gate with `node bin/forge.mjs verify framework`.

## Agent hooks approval and stale events

**Symptom:** `forge agent hooks smoke --target codex --json` passes, but `forge agent hooks status --target codex --json` reports missing native signals or stale hook signals.

**Cause:** The smoke canary proves ForgeOS ingestion and DeltaDB memory. Once a canary or useful hook event is visible, ForgeOS reports `approvalStatus: "accepted"` and the hooks are sufficient for local editing. A separate `nativeTrustStatus: "waiting-for-native-signal"` means ForgeOS has not yet seen a trusted native Codex Desktop event for stronger provenance. Hook events are queued in `.forge/agent/events.ndjson` and drained from checkpoints, so old canary events do not prove that Codex has emitted a fresh native event.

**Fix:**

```bash
forge agent hooks status --target codex --json
forge agent hooks smoke --target codex --json
```

Approve the Codex Desktop hook prompt if status is still `waiting-for-user-trust`, continue or start a Codex session in the same workspace, then rerun status. If the status remains stale, inspect the JSON `approvalStatus`, `nativeTrustStatus`, `nativeSignals`, `canarySignals`, and suggested commands before reinstalling hooks.

## DeltaDB and PGlite busy

**Symptom:** A mutating agent-memory, timeline, session, or repair command returns `FORGE_DELTA_BUSY`, or Studio reports DeltaDB/PGlite is active.

**Cause:** Another local ForgeOS or external-agent process owns the PGlite writer lock. Read-only commands should still work; writer operations fail fast instead of hanging.

**Fix:**

```bash
forge delta status --json
forge agent hooks status --target codex --json
```

Read the JSON `busy` block for lock path, pid, process-alive signal, lock age, cwd, and command. Wait for the owning command to finish when it is alive. If the process is gone, inspect `.forge/delta/delta.lock` before running repair.

## Studio target preview issues

**Symptom:** Studio opens an iframe of itself, starts duplicate target previews, or reports preview state that does not match the app.

**Cause:** Studio reserves `127.0.0.1:5173` for the observer app. The target app should normally run on preview port `5174`. ForgeOS records target preview state in `.forge/studio/preview.json` and reuses a live matching process instead of starting another one.

**Fix:**

```bash
forge studio doctor . --preview-port 5174 --target codex --json
forge studio open . --preview-port 5174 --target codex --json
```

If another tool owns preview startup, pass `--no-start`. If the recorded preview process has exited, rerun `studio open`; stale preview state is removed before a new start attempt. `.forge/studio/*.json` files are local operational state and should not be committed.

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

Production uses JWT/OIDC; local dev may use `dev-headers` mode. See [Security and Data](security-and-data.md) and generated `authConfig.json`.

## LiveQuery stale or not updating

**Symptom:** UI subscribed with `useLiveQuery` does not refresh after a command write.

**Cause:** Invalidation not recorded, worker not running, wrong tenant, or client not resuming SSE.

**Fix:**

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

Checklist:

1. Command performed a transactional write that should invalidate the table.
2. Outbox worker is running (`forge dev` includes worker by default).
3. Invalidation rows exist in `_forge_live_invalidations` with revision newer than client snapshot.
4. Client reconnects with `Last-Event-ID` or `?lastRevision=` after disconnect.

See [Frontend — LiveQuery](frontend.md#livequery).

## Repair loop

**Symptom:** Tests or verify failed; unsure what to fix.

```bash
forge do fix --json
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

Apply only **high-confidence** suggested repairs automatically. Re-run:

```bash
forge verify --changed
forge verify --strict
```

See [Testing and Repair](testing-and-repair.md).

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

## AI and agent errors

**Symptom:** `forge check` reports `FORGE_AI_FORBIDDEN_CONTEXT`.

**Cause:** `ctx.ai` or `ctx.agent` was used in a forbidden context (`command`, `query`, `liveQuery`, `client`, `shared`, or `edge`).

**Fix:**

1. Move AI logic to an **action** or **workflow** step after commit.
2. Keep the command fast: write to `ctx.db` and `ctx.emit(...)`.
3. Re-run:

   ```bash
   forge check --json
   forge inspect ai --json
   ```

See [AI — Runtime Rule](ai.md#runtime-rule) and [Runtime Model](runtime-model.md#ai-placement).

**Symptom:** `FORGE_AI_SECRET_MISSING` or `forge ai check` reports missing secrets.

**Fix:**

```bash
forge add ai
forge ai check --json
```

Configure `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `AI_GATEWAY_API_KEY` in `.env`, then restart dev.

**Symptom:** `FORGE_AI_MODEL_MISSING` or `FORGE_AI_DYNAMIC_PROVIDER`.

**Cause:** Missing static `model:` literal or dynamic `provider:` selection in source.

**Fix:** Use static string literals for `provider` and `model` so the compiler can register calls in `aiRegistry.json`.

**Symptom:** Agent run fails in dev or returns 403.

**Fix:**

```bash
forge dev --once --json
curl -X POST "$FORGE_URL/ai/agents/run" \
  -H "Content-Type: application/json" \
  -H "x-forge-user-id: dev-user" \
  -H "x-forge-tenant-id: dev-tenant" \
  -H "x-forge-role: owner" \
  -d '{"prompt":"hello","maxSteps":4}'
```

Ensure dev auth headers match your app's auth mode. Inspect tool availability:

```bash
forge ai tools --json
forge inspect agent-tools --json
```

**Symptom:** Need to debug a completed agent run.

```bash
forge ai trace <traceId> --json
```

Use the `traceId` from the API response header `x-forge-trace-id` or telemetry events.

**Symptom:** Unexpected provider charges during local development.

**Fix:** Use mock mode:

```bash
FORGE_MOCK_AI=1 forge dev
forge ai test --provider openai --model gpt-4o-mini --prompt "ping" --mock
```

**Symptom:** Chat UI executes a write tool without confirmation.

**Cause:** Command auto-tools require approval; the UI must call `addToolApprovalResponse` (AI SDK UI) before Forge executes a command tool.

See [AI — Tools And Agents](ai.md#tools-and-agents).

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
| `FORGE_AI_FORBIDDEN_CONTEXT` | AI placement | Move AI to action/workflow; see [AI](ai.md) |
| `FORGE_AI_SECRET_MISSING` | AI secrets | Configure provider keys; `forge ai check` |
| `FORGE_AI_MODEL_MISSING` | AI registry | Add static `model:` literal |
| `FORGE_AI_DYNAMIC_PROVIDER` | AI registry | Prefer static `provider:` literal |
| `FORGE_AI_GENERATION_FAILED` | AI runtime | Check secrets, model name, provider status |

Full diagnostic codes appear in CLI JSON under `errors[].code` with `fixHint` and `suggestedCommands`.

`forge check --json` also lifts diagnostic `suggestedCommands` into top-level
`nextActions`, so agents can usually move from the failing check directly to the
right repair, inspect, or refactor command.

## Escalation path

1. `forge dev --once --json` — collect snapshot
2. `forge repair diagnose ... --json` — structured analysis
3. `forge inspect all --full --json` — full contract review
4. `forge verify --strict` — confirm fix before handoff

For framework bugs, include JSON output and steps to reproduce when opening an issue on the repository.

## Related pages

- [Getting Started](getting-started.md)
- [Agent Workflow](agent-workflow.md)
- [CLI](cli.md)
- [AI](ai.md)
- [Frontend](frontend.md)
- [Testing and Repair](testing-and-repair.md)
- [forge add](forge-add.md)
- [Codemods](codemods.md)
- [Payments](payments.md)
- [Field Testing](field-testing.md)
