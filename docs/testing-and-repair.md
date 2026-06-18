# Testing and Repair

ForgeOS ties **change impact**, **targeted tests**, **verification gates**, and **repair loops** together so agents and humans do not run the full suite on every edit.

## Verification gates

```bash
forge verify --smoke
forge verify --standard
forge verify --strict
forge verify --changed
```

| Gate | Typical steps | When |
|------|---------------|------|
| `--smoke` | Generated drift, `forge check`, typecheck | Fast local sanity |
| `--standard` | Smoke + impact-selected tests | Normal dev loop |
| `--strict` | Full TestGraph + lint | Handoff / CI / release |
| `--changed` | Only tests affected by current diff | After focused edits |

Add predictable timeouts for package scripts:

```bash
forge verify --standard --script-timeout-ms 120000
```

Strict verification runs non-docker/non-browser TestGraph entries in bounded chunks.
Parallel and isolated lanes run at the same time, so the reported critical path reflects lane overlap instead of adding both lanes together.
Runtime-heavy, template, release, git, and process-spawning tests run as isolated one-file chunks with their own temp directory and dynamic dev port.
The serial lane is reserved for tests that intentionally mutate shared state in the checkout itself.
By default, Forge uses a total budget of up to 4 TestGraph jobs and reserves up to 2 of those jobs for isolated runtime-test chunks when both lanes have work.
Strict runs write measured file timings to `.forge/test-runs/testgraph-profile.json`; later runs use that profile to balance slow tests instead of chunking alphabetically.
Tune that when a machine has fewer or more cores:

```bash
forge verify --strict --test-jobs 4
FORGE_VERIFY_TEST_JOBS=1 forge verify --strict
FORGE_VERIFY_ISOLATED_TEST_JOBS=1 forge verify --strict
```

`--test-jobs` / `FORGE_VERIFY_TEST_JOBS` cap total TestGraph concurrency.
`FORGE_VERIFY_ISOLATED_TEST_JOBS` controls how much of that total budget can be assigned to the isolated lane.
When the total budget is `1`, Forge keeps the isolated chunks one-file-at-a-time and runs lanes sequentially instead of creating extra workers.

Inspect the plan without running the full suite:

```bash
forge verify --strict --test-plan --json
```

Or route through the intent router:

```bash
forge do verify --json
```

See [CLI — Verification](cli.md#verification).

## Impact-based testing

Compute what changed and which tests matter:

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge test explain tests/commands/createTicket.test.ts --json
```

Typical agent loop:

```txt
edit source
  -> forge impact --changed --json
  -> forge test run --changed --timeout-ms 120000 --json
  -> forge verify --changed
  -> forge verify --strict   (before handoff)
```

## Repair loop

When `forge check` or tests fail, do not guess — diagnose structurally:

```bash
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

For UI/browser failures:

```bash
forge ui smoke --json
forge repair diagnose --from-last-ui-run --json
```

Repair output includes:

| Field | Meaning |
|-------|---------|
| `failureKind` | Category (guard, test, generate, etc.) |
| `likelyCause` | Human-readable explanation |
| `suggestedRepairs` | Concrete fix actions with confidence |
| `confidence` | `high` / `medium` / `low` |

Apply only **high-confidence** repairs automatically. Review medium/low before changing code.

Example diagnostic:

```json
{
  "ok": false,
  "failureKind": "runtime-guard",
  "likelyCause": "A command imports a package that is only allowed in actions or workflows.",
  "suggestedRepairs": [
    {
      "confidence": "high",
      "action": "extract-action",
      "command": "forge refactor extract-action chargeCustomer --package stripe --dry-run --json"
    }
  ]
}
```

The fix is structural: move the side effect to an action or workflow instead of weakening the guard.

After repair:

```bash
forge generate
forge verify --changed
forge verify --strict
```

See [Troubleshooting](troubleshooting.md).

## Structured review

```bash
forge review run --changed --json
```

Produces findings and suggested commands for agent/human review before merge.

## UI / browser testing

```bash
forge ui smoke --json
forge ui scenario <name> --json
forge ui route <path> --json
forge ui doctor --json
```

UI tests integrate with the capability map and frontend graph. Reports land under `.forge/ui-runs/`.

## Field testing (external)

Validate ForgeOS outside the monorepo:

```bash
npm run field:test -- --dry-run --json
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --json
```

See [Field Testing](field-testing.md).

## Agent workflow

```bash
forge do fix --json
forge repair diagnose --from-last-test-run --json
forge impact --changed --json
forge test run --changed --timeout-ms 120000 --json
forge do verify --json
forge verify --strict
```

See [Agent Workflow](agent-workflow.md).

## Related pages

- [CLI](cli.md) — command reference
- [Agent Playbook](agent-playbook.md) — issue-to-handoff loop
- [Dev Loop](dev-loop.md) — local diagnostics before tests
- [Troubleshooting](troubleshooting.md) — error codes and first response
- [Codemods](codemods.md) — safe refactors when guards fail
- [Release](release.md) — pre-tag validation
