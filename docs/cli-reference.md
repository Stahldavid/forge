# CLI Reference

This page lists common ForgeOS command groups. Start with [CLI](cli.md) for the recommended workflow. Use this page when you need a specific lower-level command.

## CLI entrypoint

Generated apps use the installed ForgeOS CLI:

```bash
forge status --json
forge verify --smoke
npm run forge -- dev --once --json
```

The ForgeOS framework checkout uses the source-tree entrypoint so maintainer commands execute the code being edited:

```bash
node bin/forge.mjs status --json
node bin/forge.mjs verify framework
```

Use the global `forge` command from the framework repo only when intentionally smoking the installed package path.

## App creation

```bash
npm create forgeos-app@alpha my-app -- --template minimal-web
npm create forgeos-app@alpha . -- --template minimal-web
npm create forgeos-app@alpha nuxt-notes -- --template nuxt-web
forge new my-app --template minimal-web --package-manager npm --forge-spec "npm:forgeos@alpha" --install --no-git
forge new nuxt-notes --template nuxt-web --package-manager npm --forge-spec "npm:forgeos@alpha" --install --no-git
forge new workroom --template agent-workroom --package-manager npm --no-install --no-git
```

## Intent router

```bash
forge status --json
forge status --human
forge changed --json
forge handoff --json
forge agent onboard --target codex --json
forge doctor agent --target codex --json
forge studio open ../customer-app --preview-port 5174 --target codex --json
forge studio bridge ../customer-app --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json
forge studio bridge ../customer-app --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --probe-codex-server --json
forge studio doctor ../customer-app --preview-port 5174 --target codex --json
forge studio codex-server ../customer-app --json
forge studio codex-server ../customer-app --probe --json
forge do inspect --json
forge do "<objective>" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

`forge handoff --json` creates a compact work handoff for the next external code agent: dev diagnostic summary, git state, changed-file categories, recent test/UI run status, opening brief, recommended read files, next commands, and risks. The `git.changeSummary` block separates source, tests, docs, generated artifacts, operational files, assets, config, and other paths so large generated diffs do not hide the real edit surface. When diagnostics are numerous, `diagnosticSummary` reports total counts, grouped codes, a small sample, hidden count, and full-diagnostic commands instead of embedding a giant repeated warning list.

`forge changed --json` is the dedicated diff-orientation command. It separates human-authored changes from generated artifacts, reports staged/unstaged/untracked buckets, lists risks such as untracked or uncategorized files, and recommends the next verification commands. Large clean authored diffs are reported as `advisories`, not risks, so review tools can warn about volume without implying a broken handoff. Its `diffPlan` gives an authored-first diff command, a generated-only diff command, and a compact reason for collapsing generated artifacts until the source cause is understood.

When generated artifacts dominate the worktree, read `forge changed --authored --json` or the returned `diffPlan.authoredDiffCommand` before opening raw diffs. Template apps may ignore generated artifacts in git; framework checkouts keep them available as derived evidence.

`forge add <package> --frontend`, `forge add frontend:<package>`, `forge add <package> --backend`, and `forge add backend:<package>` are normal npm package installs with explicit app-side intent. JSON includes `packageTarget`, `packageTargetReason`, `nativeInstallCommand`, and `avoidedManualCommand`, so Studio and agents can show which package.json will change and which native package-manager command Forge is managing.

`forge status --json` also includes a lightweight `git` block with categorized changed, staged, unstaged, and untracked files. Its top-level `generated` block gives Studio and external agents an explicit state (`ready`, `check-needed`, `missing-artifacts`, or `drift`) plus the safe dev/check/repair commands, so they do not have to infer stale generated state from filenames. `check-needed` means required artifacts are present but authored source/config changes could affect generated output, so agents should run `forge generate --check --json` before treating freshness as proven. Its `studio` block gives the open/attach/snapshot/bridge/watch/doctor commands, target preview URL, start command, and probe command for observer UIs. The human output prints the same generated and Studio detail. Use it when you need quick orientation before the fuller `handoff` or `dev --once` snapshots.

`forge agent onboard --target codex --json` is the one-command entry point for a freshly opened external agent session. It prepares the target adapter, installs/proves hooks when supported, runs the compact dev diagnostic snapshot, and returns `readyToEdit`, recommended read files, and next commands.

`forge doctor agent --target codex --json` is the top-level spelling for agent readiness checks. It delegates to `forge agent doctor` and reports adapter freshness, hook bridge status, recent useful signals, next actions, and diagnostics.

`forge studio open <path> --preview-port 5174 --target codex --json` is the recommended Studio entrypoint. It attaches an app directory to a Studio-style observer without moving the coding agent into the browser, writes `.forge/studio/attachment.json`, prepares the selected agent adapter/hook bridge, checks whether dependencies are installed, auto-starts the local target preview when possible, and attempts one bridge ingest to the Studio runtime. The JSON result includes `previewAutomation` for dependency/start evidence and `bridge` for Studio delivery evidence. Use `--install` to let ForgeOS run the detected install command, `--no-start` when another process owns preview startup, and `--no-bridge` for attach/start only. `forge studio attach` is the lower-level command for writing the attachment manifest and preparing adapters without startup/bridge orchestration. `commands.startTargetAppCwd`, `commands.startTargetApp`, `commands.openPreview`, and `commands.probePreview` tell Studio exactly what to show and where the command should run. `preview.status` reports whether a local preview was reachable, not running, or intentionally not checked. `posture` reports generated freshness and authored-first review commands. If a preview points at local port `5173`, ForgeOS treats it as likely Studio self-preview and shifts the target app preview to `5174` unless `--force` is provided. Live target preview state is recorded under `.forge/studio/preview.json`; a later `studio open` reuses a still-running matching preview instead of spawning a duplicate, and removes stale preview state when the recorded process is gone.

`forge studio snapshot <path> --preview-port 5174 --target codex --json` is the read-only version for Studio refresh loops. It does not write `.forge/studio/attachment.json`, does not prepare adapters, and does not regenerate stale artifacts. It returns app metadata, preview status, ForgeOS posture, `forge changed` buckets, `diffPlan`, `contextPacket`, a `handoff` block with the recommended `forge agent context --handoff --json` command, hook proofs, DeltaDB status, plus the commands the UI should show. If an attachment manifest already exists, snapshot reuses its preview URL and targets unless the command overrides them. Add `--probe-codex-server` when a Codex-targeted snapshot should include the actual `codex app-server` stdio initialize proof under `proofs.codexAppServer.handshake`.

`forge studio bridge <path> --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json` is the official ForgeOS-to-Studio signal bridge. It collects the same read-only snapshot and posts it to the Studio runtime command `ingestStudioSnapshot` with local dev-auth headers. Use `--once` for a single ingest, `--dry-run` to prove the snapshot contract without network delivery, and `--interval-ms 5000` to control the continuous bridge cadence. Bridge success means the snapshot was delivered or dry-run collected; the embedded snapshot can still report generated drift, preview down, or hook warnings so Studio can show the actual evidence.

`forge studio doctor <path> --preview-port 5174 --target codex --json` is the Studio trust gate. It checks preview reachability, generated freshness, hook usefulness, DeltaDB readability, and optional Codex app-server availability. Add `--probe-codex-server` to prove the stdio initialize handshake in the same snapshot/doctor/bridge flow. `forge studio codex-server <path> --json` is the narrow Codex app-server diagnostic: it reports whether `codex app-server` is available, which schema generation commands match the local Codex version, how Studio should connect over stdio, and which WebSocket/security constraints to respect. Add `--write` when you want ForgeOS to run both schema generation commands and write `.forge/codex-app-server-schemas`; the default is read-only. Add `--probe` when you want ForgeOS to start `codex app-server`, perform the `initialize`/`initialized` stdio handshake, make safe read-only `model/list` and `account/read` RPCs, report sanitized protocol readiness, and exit before starting a Codex thread or turn. `forge studio watch <path> --preview-port 5174 --target codex --json` emits a Studio-shaped `studio.snapshot` event; long-running reload streams continue to come from `forge dev --watch --json`.

Studio reserves `http://127.0.0.1:5173` and `http://127.0.0.1:3765` for the observer app. The app being observed defaults to `http://127.0.0.1:5174` for web preview and `http://127.0.0.1:3766` for its ForgeOS runtime, so `commands.startTargetApp` uses `forge dev --port 3766 --web-port 5174`.

## Development

```bash
forge dev
forge dev --once --json
forge dev --mock-ai
```

`forge dev` regenerates Forge artifacts before startup and, with watch enabled, regenerates and reloads the runtime after source changes so `_generated` does not stay stale during the agent loop. Startup JSON, `forge dev --once --json`, and human output expose `summary.generated.state`, changed artifact counts, sample generated paths, and the exact generate/check commands so agents do not have to infer freshness from file timestamps.

`forge dev --once --json` is the compact agent/CI entrypoint. Read `summary.agentContext` for safe-to-edit state, whether generated artifacts are fresh after the cycle, whether the cycle regenerated files (`generatedChangedFiles`), changed-file counts, `changeSummary` buckets, `diffPlan` review commands, blocking issues, recommended read files, recommended commands, and deeper `--full` commands.

In long-running watch mode, `forge dev --json` emits incremental `dev.reload` events with `generated`, `preview`, and `agentContext`, followed by the full watch-cycle snapshot. `dev.generate_failed` events include generated stale-risk evidence and recovery commands. This gives Forge Studio a streaming source of truth instead of requiring log scraping.

Read `summary.preview.targetAppUrl` when a Studio or observer UI needs the app-under-construction URL. If Studio itself is running at `http://127.0.0.1:5173`, ForgeOS suggests `http://127.0.0.1:5174` for the internal app preview instead of pointing the iframe back at Studio.

## Generation and checks

```bash
forge generate
forge generate --check
forge check
forge check --json
forge doctor
forge doctor --json
forge doctor windows --json
```

When `forge generate --check --json` finds generated drift, JSON includes a
compact `drift` object with `kind: "generated-drift"`, changed artifact groups,
sample paths, hidden counts, and the repair/check commands. The top-level
`summary` mirrors that with `changedSample`, `hiddenChanged`, and
`diagnosticGroups`, so agents can decide whether to regenerate without reading
hundreds of repeated `FORGE_DRIFT` diagnostics.

## Inspection

```bash
forge inspect --json
forge inspect summary --json
forge inspect all --brief --json
forge inspect all --json
forge inspect all --full --json
forge inspect app --json
forge inspect data --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect secrets --json
forge inspect client --json
forge inspect ai --json
forge inspect agent-tools --json
forge inspect framework --json
forge inspect imported --json
forge import analyze --json
forge import inspect --json
forge import inspect --target candidate-entries --json
```

Bare `forge inspect` defaults to `summary`. Use `forge inspect all --brief --json` as the first aggregate read when context budget matters. It returns summary counts, preferred entrypoints, artifact status, and high-value file refs without embedding the larger framework/test/dependency payloads. Use `forge inspect all --json` for the compact diagnostic bundle and `--full` only when a tool needs the full generated machine contract. The `all` variants include a `payload` block that names the mode, what was included or omitted, and the command to switch to brief/compact/full output.

## CAIR agent protocol

```bash
forge cair snapshot
forge cair query "Q STATUS"
forge cair query "Q ST"
forge cair query "Q S name=createTicket"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
forge cair query "Q DEP.API package=zod symbol=object"
forge cair action --plan "A RN t=S#1 nn=openTicket"
forge cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
forge cair action "A ROLLBACK journal=.forge/cair/journal/<journal>.json"
```

CAIR is the compact agent protocol for semantic repository navigation and guarded edits. Use `snapshot` and `query` before opening whole files when symbol, reference, impact, or package API context is enough. Mutations should be planned first with `action --plan`; applying a plan checks target hashes and writes a rollback journal.

Common compact aliases:

| Long form | Compact |
|-----------|---------|
| `Q STATUS` | `Q ST` |
| `Q SYMBOL` | `Q S` |
| `Q DEF` | `Q D` |
| `Q REFS` | `Q R` |
| `Q IMPACT` | `Q I` |
| `A RENAME.SYMBOL target=S#1 newName=x` | `A RN t=S#1 nn=x` |

## Verification

```bash
forge verify --smoke
forge verify quick
forge verify --standard
forge verify agent
forge verify --strict
forge verify release
forge verify framework
forge verify --changed
forge verify --standard --script-timeout-ms 120000 --json
```

Aliases map to verifier profiles: `quick` is smoke/fast, `agent` is standard impact-based verification for the normal external-agent loop, `release` is strict app release verification, and `framework`/`internal`/`maintainer` are explicit ForgeOS framework maintainer verification.
`forge verify` is app-first. It verifies the current ForgeOS app; it does not run the ForgeOS framework's internal test suite unless the current checkout is the framework repo and the command explicitly uses `forge verify framework` or `--internal`.
Unknown positional profiles fail early with the accepted profile list instead of silently running the default verifier.

## DeltaDB, Timeline, and Sessions

```bash
forge delta status --json
forge delta status --verbose --json
forge doctor delta --json
forge delta compact --dry-run --json
forge delta prune --older-than 30d --dry-run --json
forge delta prune --older-than 30d --yes --json
forge delta export --redacted --output .forge/delta/export.json --json
forge timeline --json
forge timeline billing.createInvoice --json
forge timeline billing.createInvoice --causal --json
forge timeline --stale-proofs --json
forge timeline policy:billing.manage --json
forge timeline --session current --json
forge timeline rebuild --json
forge explain billing.createInvoice --json
forge explain src/policies.ts --json
forge explain session current --json
forge session list --json
forge session show current --json
forge session rename current "Import billing external service" --json
forge session merge current worksess_... --json
forge session split current op_... --json
forge session detach op_... --json
```

Use `doctor delta` for the fast recorder trust gate. Use `delta compact` and `delta prune` for local agent queue-history maintenance. Use `delta export --redacted` for a safe support bundle; non-redacted exports are rejected. `timeline --causal` and `timeline --stale-proofs` keep the same projection but make the intended causal/stale-proof read explicit in JSON.

## Authoring

```bash
forge make list --json
forge make resource notes --fields title:text,status:enum=open+done --with-ui --dry-run --json
forge make resource notes --fields title:text,status:enum=open+done --with-ui --yes
forge make ui --framework vite --dry-run --json
forge make ui --framework nuxt --dry-run --json
forge make ai-chat support --dry-run --json
forge feature validate .forge/blueprints/example.json --json
forge feature plan .forge/blueprints/example.json
forge feature apply .forge/blueprints/example.json --yes
```

## Refactors and codemods

```bash
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename table tickets supportTickets --dry-run --json
forge refactor extract-action chargeCustomer --package stripe --dry-run --json
```

Use dry runs for schema, policy, package, or UI edits.

## Integrations and packages

```bash
forge add stripe --dry-run --json
forge add stripe
forge add ai
forge add lucide-react --workspace web
forge add package @tanstack/react-query --workspace web
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
forge deps outdated --json
forge deps upgrade-plan stripe --to latest
forge deps upgrade-apply .forge/upgrades/<plan>.json
```

## Security and data

```bash
forge auth check --json
forge auth prove --json
forge authmd generate
forge authmd check --json
forge workos install --yes --json
forge workos doctor --json
forge workos doctor --yes --json
forge workos seed --file workos-seed.yml --json
forge policy simulate tickets.create --role member --json
forge secrets list --json
forge secrets prove --json
forge env check --json
forge db diff --json
forge db migrate --db pglite
forge rls check --json
forge rls test --db postgres --json
forge rls mutate-test --json
forge security prove --json
forge security prove --db postgres --full --json
```

## AI

```bash
forge ai providers --json
forge ai models --json
forge ai check --json
forge ai tools --json
forge ai agents --json
forge ai redteam --json
forge ai redteam --model-level --json
forge ai redteam --model-level --live --provider gateway --model openai/gpt-5.4 --json
forge ai test --provider openai --model gpt-4o-mini --prompt "hello" --mock
forge ai trace <traceId> --json
```

## Testing, repair, and review

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge test explain tests/commands/createTicket.test.ts --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
forge review run --changed --json
```

`forge review run --changed --json` is compact by default and includes `changeSummary`, `reviewFocus`, and `diffPlan`, so agents review authored source/tests/docs/config first and inspect generated artifacts after the source cause is understood. Use `forge review run --changed --full --json` for the complete report.

## UI and browser tests

```bash
forge ui audit --json
forge ui smoke --json
forge ui scenario <name> --json
forge ui route <path> --json
forge ui doctor --json
```

`forge ui audit --json` is a cheap no-browser gate. It validates route/scenario
coverage and stable `data-forge-testid` selectors, then scans frontend source
for UX readiness signals: semantic landmarks, accessible form labels, named
buttons, loading/error/empty states for Forge data hooks, and an obvious
sign-in/session/organization flow when generated metadata shows tenant-scoped
data or production auth modes. These are warnings by default so smoke checks
stay fast, but they give agents concrete UI fixes before browser testing.

## LiveQuery

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

## Agent contract and adapters

```bash
forge agent-contract generate
forge agent-contract check
forge agent-contract print --json
forge agent print-context --json
forge agent context --current --json
forge agent memory --json
forge agent ingest codex --event UserPromptSubmit --input '{"hook_event_name":"UserPromptSubmit","session_id":"s1","turn_id":"t1","model":"test","prompt":"hello"}' --json
forge agent ingest codex --watch --file .forge/agent/events.ndjson --json
forge agent hooks status --target codex --json
forge agent hooks smoke --target codex --json
forge agent timeline --json
forge agent timeline --target codex --json
forge agent install codex --dry-run --json
forge agent install claude-code --dry-run --json
forge agent install cursor --dry-run --json
forge mcp serve
forge agent export --target generic
forge agent export --target cursor
forge agent export --target codex
forge agent export --target claude
```

`forge agent context` and `forge agent memory` use compact human-readable summaries by default. Add `--json` for machine-readable context and detailed memory audit events. Agent memory read commands should not block on the DeltaDB writer lock; write commands such as ingest, hook smoke, repair, timeline rebuild, and session mutations may fail fast with `FORGE_DELTA_BUSY`.

Codex Desktop has an additional trust boundary for newly installed hooks. `forge agent hooks smoke --target codex --json` writes a ForgeOS canary and proves that Agent Memory can read it. `forge agent hooks status --target codex --json` reports `approvalStatus`, `approvalRequired`, `nativeTrustStatus`, `nativeSignals`, and `canarySignals`; `waiting-for-user-trust` means no canary, useful hook event, or native signal has appeared yet, while `approvalStatus: "accepted"` with `nativeTrustStatus: "waiting-for-native-signal"` is sufficient for local editing but still lacks native Codex provenance proof.

`forge agent ingest <source> --watch --file <path>` is explicit and opt-in. It tails JSON or NDJSON hook/export files and records normalized Agent Memory events until interrupted.

## Self-host

```bash
forge self-host compose
forge self-host check --json
```

## Release and field testing

```bash
npm run field:test -- --dry-run --json
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "npm:forgeos@alpha" --install --json
npm run release:pack
npm run release:evidence
npm run release:publish-alpha
```

## Related pages

- [CLI](cli.md)
- [Agent Workflow](agent-workflow.md)
- [Testing and Repair](testing-and-repair.md)
- [Release](release.md)
