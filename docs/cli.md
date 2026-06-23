# CLI

ForgeOS centers day-to-day work around a small command loop:

```bash
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge dev
forge dev --once --json
forge check --json
forge verify agent
```

Use this page for common workflows. Use [CLI Reference](cli-reference.md) when you need the full command list.

`forge inspect` defaults to `forge inspect summary`, so the bare command is a
compact orientation pass. `forge inspect all --brief --json`,
`forge inspect all --json`, and `forge inspect all --full --json` each include a
`payload` block that says what was included, what was omitted, and which command
switches to the other depth.

Prefer **[Agent Workflow (`forge do`)](agent-workflow.md)** when you know the goal but not the exact command.

`forge status --json` is the cheapest first read. It reports project health, a structured `generated` block (`state`, `ready`, `driftClean`, missing artifact count, table drift count, and repair/check commands), handoff readiness, next actions, and a compact `git.changed` summary grouped by file type.

`forge changed --json` is the dedicated current-diff view. It separates human-authored files from generated artifacts, highlights untracked or uncategorized paths, and returns the focused verification commands for the current work. Read `diffPlan` before opening raw diffs: it gives the authored-first diff command, the generated-artifact diff command, and whether generated files are collapsed by default.

When generated artifacts dominate the worktree, use `forge changed --authored --json` or the `diffPlan.authoredDiffCommand` first. Template apps may ignore generated artifacts in git; framework checkouts keep them available as derived evidence and should review authored changes before generated output. See [Generated Artifacts](generated-artifacts.md).

Use `forge handoff --json` when switching between external code agents. It runs the compact dev diagnostic loop, summarizes git state, groups changed files by type (`source`, `tests`, `docs`, `generated`, `operational`, and related buckets), includes recent test/UI run status, and returns an `openingBrief`, high-value files to read, next commands, and handoff risks.

## Create an App

```bash
npm create forgeos-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

Lower-level equivalent:

```bash
forge new notes-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
```

Use `--template agent-workroom` when you want an app preview plus an
external-agent evidence room instead of a domain CRUD starter.

See [Getting Started](getting-started.md) and [Templates](templates.md).

## Agent workflow (`forge do`)

```bash
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge do "add stripe checkout" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

See [Agent Workflow](agent-workflow.md).

## Local Development

```bash
forge dev
forge dev --once --json
forge dev --mock-ai
```

`forge dev` runs the local backend, worker, checks, and web app when present. It regenerates Forge artifacts before startup and, with watch enabled, regenerates and reloads the runtime after source changes so `_generated` does not stay stale. Startup output includes `generated.state` (`fresh`, `regenerated`, or `stale-risk`), changed generated artifact counts, and the exact generate/check commands. `forge dev --once --json` performs a single diagnostic pass and exits with the same generated posture under `summary.generated`. Use `--mock-ai` to avoid real provider calls during local agent or AI testing.

The `--once --json` response includes `summary.agentContext`, a compact contract for external code agents. It reports whether the project is safe to edit, whether generated artifacts are fresh, how many changed files are in the current diff, a `changeSummary` grouped by file type, `diffPlan` commands for authored-first versus generated-only review, blocking issue summaries, high-value files to read, recommended next commands, and the deeper `--full` commands to use when more detail is needed.

It also includes `summary.preview.targetAppUrl`. Studio-style observer apps should embed that URL for the app under construction. If Forge Studio itself is running at `5173`, the target app preview is normally `5174`.

When `forge dev --json` runs in watch mode, incremental `dev.reload` events include the same observer posture: `generated`, `preview`, and `agentContext`. Studio can update generated freshness, authored-first diff commands, and the target preview without reinterpreting logs. `dev.generate_failed` events include `generated.state: "stale-risk"` plus the diagnostics and recovery commands.

When a local web port is already busy, `forge dev` resolves the web port before
startup and reports the actual selected URL. In JSON output, `web.requestedPort`
and `web.autoPortSelected` show when Forge moved from the preferred port.

When a web app is present, `forge dev` also exposes agent endpoints documented in [AI](ai.md):

- `POST /ai/agents/run` — JSON agent runs for automation
- `POST /ai/agents/chat` — AI SDK UIMessage streaming for chat UIs

See [Frontend](frontend.md) for hooks, capability map, and liveQuery.

## Studio Observer Attach

```bash
forge studio open ../customer-app --preview-port 5174 --target codex --json
forge studio attach ../customer-app --preview-port 5174 --target codex --json
forge studio snapshot ../customer-app --preview-port 5174 --target codex --json
forge studio snapshot ../customer-app --preview-port 5174 --target codex --probe-codex-server --json
forge studio doctor ../customer-app --preview-port 5174 --target codex --json
forge studio codex-server ../customer-app --json
forge studio codex-server ../customer-app --probe --json
forge studio watch ../customer-app --preview-port 5174 --target codex --json
```

Use `forge studio open` as the normal entrypoint for an observer workroom. It attaches the observed app, prepares the selected adapter and hook bridge, checks dependency readiness, starts the target preview when it is local and safe to start, and sends a one-shot snapshot to the Studio bridge when the Studio runtime is reachable. It returns `previewAutomation`, `bridge`, and the follow-up commands Studio should show. Pass `--install` to allow dependency installation, `--no-start` to keep preview startup manual, or `--no-bridge` to skip the Studio ingest attempt. The browser remains an observer; Codex, Claude Code, or Cursor still edit the app externally. `forge studio attach` is the lower-level command for writing `.forge/studio/attachment.json` and preparing adapters without startup/bridge orchestration.

Use `forge studio snapshot` for the read-only refresh loop. It does not write the attachment manifest, does not prepare adapters, and does not regenerate stale artifacts. It returns app metadata, preview status, ForgeOS posture, `forge changed` diff buckets, `contextPacket`, hook proofs, DeltaDB status, and the commands Studio should surface. When `.forge/studio/attachment.json` already exists, snapshot reuses its preview URL and targets unless the current command overrides them. Add `--probe-codex-server` when a Codex-targeted snapshot should also start `codex app-server`, perform the stdio `initialize` handshake, attach the result at `proofs.codexAppServer.handshake`, and exit without starting a thread or turn.

Use `forge studio doctor` as the trust gate for Studio. It checks preview reachability, generated freshness, hook usefulness, Codex hook approval state, DeltaDB readability, and optional Codex app-server availability. Add `--probe-codex-server` when the doctor or bridge should prove the app-server handshake, not only its availability. Use `forge studio codex-server` when the UI only needs that Codex-specific app-server proof: it returns schema generation commands, stdio connection guidance, and security notes without collecting the full Studio snapshot. Add `--write` to generate version-matched app-server schemas into `.forge/codex-app-server-schemas`; without `--write`, the command stays read-only. Add `--probe` to start `codex app-server` over stdio, send the documented `initialize`/`initialized` handshake, make safe read-only `model/list` and `account/read` RPCs, and then exit without starting a thread, turn, shell command, or browser-visible agent session. ForgeOS stores only sanitized readiness facts such as model count, sample model ids, account type, plan type, and `requiresOpenaiAuth`. Use `forge studio watch` when an observer UI wants a Studio-shaped JSON event; long-running file/reload streaming still comes from `forge dev --watch --json`.

When an attach preview points at local port `5173`, ForgeOS assumes that is the Studio shell and automatically uses `5174` for the app being built. Pass `--force` only when `5173` is intentionally the target app.

Studio flows keep ports separate by default: Forge Studio uses `5173` for its UI and `3765` for its runtime/bridge, while the observed app uses `5174` for preview and `3766` for its own ForgeOS runtime. The start command returned by `forge studio open` is therefore `forge dev --port 3766 --web-port 5174`.

## Introspection

```bash
forge status --json
forge agent print-context --json
forge inspect --json
forge inspect summary --json
forge inspect all --brief --json
forge inspect all --json
forge inspect all --full --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect ai --json
forge inspect agent-tools --json
forge inspect framework --json
forge inspect imported --json
forge doctor
forge doctor windows --json
```

### Common `forge inspect` targets

| Target | Shows |
|--------|-------|
| `all` | Compact aggregate project snapshot; use `--full` for the deep dump |
| `app` | Commands, queries, actions, workflows |
| `data` | Schema, tables, tenant scope |
| `frontend` | Routes, components, bridge files |
| `capabilities` | UI ↔ runtime bindings |
| `runtime-matrix` | Package context compatibility |
| `policies` | RBAC registry |
| `secrets` | Required secret names |
| `client` | Generated client manifest |
| `ai` | Providers, generations, placement |
| `agent-tools` | Explicit + auto tools |
| `framework` | ForgeOS CLI/modules (in framework repo) |
| `imported` | Brownfield import artifacts from `.forge/import` |

Use these when an agent needs to understand the project before changing it.

## CAIR Agent Protocol

```bash
forge cair snapshot
forge cair query "Q STATUS"
forge cair query "Q DEF S#1"
forge cair query "Q REFS S#1"
forge cair query "Q IMPACT S#1"
forge cair action --plan "A RENAME.SYMBOL target=S#1 newName=openTicket expect.file=src/commands/createTicket.ts expect.kind=command expect.hash=<hash>"
forge cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
forge cair action --plan "A MAKE.TABLE name=tickets fields=title:text"
forge cair action --plan "A ADD.TEST target=S#1 kind=unit"
forge cair action --plan "A WIRE.EXPORT target=S#1 file=src/index.ts"
```

CAIR is the compact agent language for reading and changing a Forge workspace. `snapshot` emits `@cair 0.5.0 snapshot=<hash>` plus compact module, symbol, package, API, and test identifiers. `query` answers semantic questions without forcing an agent to read whole files. `action --plan` writes a guarded plan to `.forge/cair/plans`; `A APPLY` applies that plan only when target file hashes still match; applied changes write rollback journals in `.forge/cair/journal`.

Long-form verbs are stable for readability. v0.5 also supports compact aliases for token efficiency:

| Long form | Compact |
|-----------|---------|
| `Q STATUS` / `Q SYMBOL` / `Q DEF` / `Q REFS` / `Q IMPACT` | `Q ST` / `Q S` / `Q D` / `Q R` / `Q I` |
| `A RENAME.SYMBOL target=S#1 newName=x` | `A RN t=S#1 nn=x` |
| `A ORGANIZE.IMPORTS file=M#1` / `A FORMAT file=M#1` | `A OI f=M#1` / `A FMT f=M#1` |
| `A MAKE.COMMAND name=x` / `A MAKE.TABLE name=x` | `A MC n=x` / `A MT n=x` |
| `A ADD.TEST target=S#1` / `A WIRE.EXPORT target=S#1` | `A AT t=S#1` / `A WX t=S#1` |

## Brownfield Import Analysis

```bash
forge import analyze --json
forge import inspect --json
forge import inspect --target candidate-entries --json
forge inspect imported --json
```

`forge import analyze` scans an existing TypeScript/JavaScript app without changing source code. It writes `.forge/import/inventory.json`, `routes.json`, `frontendCalls.json`, `candidateEntries.json`, `riskReport.json`, `migrationPlan.md`, and `importedAgentContract.json`.

All imported entries start with `origin: imported`, `assurance: static-scan`, `reviewStatus: needs-review`, and `visibleToAgent: false`. Command-like, destructive, external, or unknown entries keep `needsApproval: true` until a human review turns them into native Forge commands, queries, actions, or workflows.

See [Brownfield Import](brownfield-import.md) for the full migration workflow.

## Generation and Verification

```bash
forge generate
forge generate --check
forge check --json
forge verify quick
forge verify --standard
forge verify agent
forge verify --strict
forge verify release
forge verify framework
forge release doctor --json
```

### Verification

| Command | Runs |
|---------|------|
| `forge verify quick` | Alias for smoke/fast checks |
| `forge verify --smoke` | Generated drift, Forge checks, typecheck (fast) |
| `forge verify agent` | Alias for the standard external-agent loop |
| `forge verify --standard` | Smoke + impact-selected tests (normal dev gate) |
| `forge verify release` | Alias for strict app release verification |
| `forge verify --strict` | Strict app-level verification: app TestGraph in bounded parallel/isolated chunks + lint |
| `forge verify framework` | Maintainer-only ForgeOS framework verification; runs the ForgeOS internal TestGraph |
| `forge verify --changed` | Checks/tests for current diff only |
| `forge release doctor --json` | Release readiness aggregate, including `npm pack --dry-run --json` package validation |

```bash
forge verify --standard --script-timeout-ms 120000 --json
forge verify --strict --test-jobs 4 --json
forge verify framework --test-plan --json
forge verify --standard --typechecker native --json
forge do verify --json
```

`forge verify` is app-first: it verifies the current ForgeOS app, not the ForgeOS framework package itself. In ordinary apps, `--strict` runs that app's TestGraph. In the `forgeos` framework checkout, internal framework tests are maintainer-only and require `forge verify framework` or `forge verify --internal`. `--test-plan` prints the strict TestGraph lane/chunk plan without running tests. `--test-jobs` is the total TestGraph concurrency budget; isolated lane workers are reserved from that same budget so runtime-heavy files can overlap with ordinary chunks without oversubscribing the machine. With `--test-jobs 1`, lanes run sequentially while isolated chunks still execute one file at a time. Strict TestGraph runs write measured durations to `.forge/test-runs/testgraph-profile.json`; later plans use that profile to balance slow files across chunks.

`--typechecker native` uses the TypeScript 7 native checker when it is available and falls back to the stable `tsc` path with a warning when it is not. The recommended setup is an alias package, which keeps Forge's programmatic TypeScript API on the existing dependency while exposing the TS7 checker binary:

```bash
npm install -D typescript-7@npm:typescript@rc
forge verify --standard --typechecker native
```

Resolution order is `FORGE_TS7_TSC`, local `typescript-7`, root `typescript` only when it is version 7 or newer, then `@typescript/native-preview` / `tsgo` for compatibility. `--typechecker auto` tries the native path first and falls back to `tsc`; `--typechecker ts7` is an alias for `native`; `--typechecker tsgo` keeps the old preview mode. Tune native parallelism with `FORGE_TS7_CHECKERS`, `FORGE_TS7_BUILDERS`, or force single-threaded mode with `FORGE_TS7_SINGLE_THREADED=1`.

See [Testing and Repair](testing-and-repair.md).

## Integrations

Use `forge add` instead of manual `npm install` for recipe-backed integrations. It installs packages, emits generated adapters, registers secret names, updates the runtime matrix, and feeds the generated agent contract.

```bash
forge add stripe --dry-run --json
forge add stripe
forge add ai
forge add lucide-react --workspace web
forge inspect runtime-matrix --json
forge inspect secrets --json
```

See [forge add](forge-add.md), [Package Intelligence](package-intelligence.md), [Recipes](recipes.md), and [Payments](payments.md).

## Dependency API oracle (for agents and upgrades)

After `forge add` or `forge generate`, inspect installed package APIs without reading all of `node_modules`:

```bash
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
forge deps outdated --json
forge deps upgrade-plan stripe --to latest
forge deps upgrade-apply .forge/upgrades/<plan>.json
```

Use `forge deps api` when an agent needs signatures, JSDoc, examples, resolution traces, and runtime placement hints for a specific SDK symbol. This lets agents verify package APIs before coding instead of relying on stale model memory. Summaries also appear in `agentContract.json` under `dependencyApis`.

See [Package Intelligence](package-intelligence.md) and [forge add — Dependency API for agents](forge-add.md).

## Security and data

```bash
forge auth check --json
forge policy simulate tickets.create --role member --json
forge secrets list --json
forge env check --json
forge db diff --json
forge db migrate --db pglite
forge rls check --json
```

See [Security and Data](security-and-data.md).

## AI

```bash
forge add ai
forge ai providers --json
forge ai models --json
forge ai check --json
forge ai tools --json
forge ai agents --json
forge ai test --provider openai --model gpt-4o-mini --prompt "hello" --mock
forge ai trace <traceId> --json
forge make ai-chat support --dry-run --json
```

| Subcommand | Purpose |
|------------|---------|
| `providers` | List configured AI providers from `aiRegistry.json` |
| `models` | List known models and cost metadata |
| `check` | Verify required provider secrets are configured |
| `test` | Run a single generation (`--mock` avoids network) |
| `tools` | List explicit and auto-generated agent tools |
| `agents` | List declared agent definitions |
| `trace` | Inspect a recorded agent/AI run by trace id |

See [AI](ai.md) for runtime placement, simple generation, agents, and tool approval.

## Authoring

```bash
forge make list --json
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --yes
forge make ui --framework vite --yes
forge make ui --framework nuxt --yes
forge make ai-chat support --yes
forge feature validate .forge/blueprints/example.json --json
forge feature plan .forge/blueprints/example.json
forge feature apply .forge/blueprints/example.json --yes
```

See [Authoring](authoring.md).

## Refactors

```bash
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename field notes.status notes.state --dry-run --json
forge refactor extract-action charge --package stripe --dry-run --json
```

Use `--dry-run --json` for plans that touch schema, policies, or UI wiring. See [Codemods](codemods.md).

## Testing, repair, and review

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge review run --changed --json
forge ui smoke --json
```

`forge review run --changed --json` returns an agent-sized summary by default. Read `diffPlan` and `reviewFocus` first: authored source/tests/docs/config are the primary review surface, while generated artifacts are derived evidence. Add `--full` when you need the complete changed-file and generated-artifact payload.

See [Testing and Repair](testing-and-repair.md).

## LiveQuery

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

See [Frontend — LiveQuery](frontend.md#livequery).

## Agent contract and adapters

```bash
forge agent-contract check
forge agent print-context --json
forge agent export --target generic
forge agent export --target cursor
forge agent export --target codex
forge agent export --target claude
```

`forge agent context` and `forge agent memory` are compact in human mode. Use `--json` for the machine contract or detailed audit payloads. Agent memory reads should stay usable while another ForgeOS process records events; only writes and repairs can return `FORGE_DELTA_BUSY`.

See [Agent Contract](agent-contract.md).

## Self-host

```bash
forge self-host compose
forge self-host check --json
```

See [Self-Host](self-host.md).

## When checks fail

```bash
forge doctor
forge check --json
forge repair diagnose --from-last-test-run --json
```

See [Troubleshooting](troubleshooting.md).
