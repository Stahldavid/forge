# forgeos

## 0.1.0-alpha.42

### Patch Changes

- Make the ForgeOS production-like golden path explicit and verifiable.

  - Add `forge field-test run --realistic` as the compact app validation path
    for runtime, auth, and UI probes, defaulting to the WorkOS-backed
    `vendor-access` flow when no template/auth override is provided.
  - Add `forge deploy package --target docker` as the user-facing production
    packaging command while keeping `forge deploy render docker` compatible.
  - Add `forge workos prove --file workos-seed.yml --json` as a no-dashboard
    aggregate proof for WorkOS/AuthKit/FGA/seed readiness, with `--real`
    applying hosted setup through the existing WorkOS CLI integration.
  - Promote `vendor-access` into a production-shaped field-test template with
    deterministic all-tenant seeding, local identity profiles, WorkOS-style
    permissions, auth metadata, UI scenarios, multi-tenant domain probes, and
    deploy-readiness evidence.
  - Tighten `forge field-test report` and `forge deploy check --production` so
    they require concrete runtime, auth setup, auth metadata, UI, UI
    ergonomics, seed readiness, and tenant-isolation evidence before reporting
    deploy readiness.
  - Improve UI ergonomics and browser probe diagnostics for local-vs-production
    auth boundaries, seeded first-run state, policy denials, raw runtime errors,
    and product surfaces that expose framework/demo internals too prominently.
  - Add `forge seed status/dev/reset`, all-tenant seed startup support through
    `forge dev --seed --all-tenants`, and seed readiness evidence in dev and
    field-test summaries.
  - Update templates, docs, and tests around the new `create app -> add auth ->
    field-test -> deploy` path.

## 0.1.0-alpha.41

### Patch Changes

- Fix package install detection for npm workspace apps that hoist frontend
  dependencies to an ancestor `node_modules`.

  - `forge add auth workos` now recognizes `@workos-inc/authkit-react` when npm
    installs it from a `web/` workspace but physically hoists it to the root
    workspace.
  - Package version detection now walks ancestor `node_modules` directories,
    matching Node/workspace resolution more closely.
  - Add regression coverage for scoped hoisted workspace packages and the
    WorkOS AuthKit install path.

## 0.1.0-alpha.40

### Patch Changes

- Complete the WorkOS/AuthKit production-like app setup loop.

  - Add `forge workos setup --real --file workos-seed.yml --json` as the
    explicit no-dashboard apply path for WorkOS hosted redirect URI, CORS,
    homepage, webhook, and seed configuration.
  - Make `forge workos doctor` validate production OIDC/JWT readiness,
    browser AuthKit environment variables, the frontend AuthKit package, and
    actual AuthKit provider mounting in the web app shell.
  - Generate a Vite React WorkOS bridge that wraps `AuthKitProvider`, forwards
    `getAccessToken()` into `ForgeProvider`, preserves `forgeUrl`, and handles
    the `/login` sign-in endpoint flow.
  - Teach `forge add auth workos` to install `@workos-inc/authkit-react` in a
    detected `web/` workspace and automatically rewrite the default Forge Vite
    root from local `devAuth` to `ForgeWorkOSAuthProvider`.
  - Keep custom web roots safe by leaving them unchanged and emitting actionable
    doctor/UI-audit guidance when AuthKit still needs to be mounted manually.
  - Expose production auth readiness in `/health` and make `authmd check` fail
    when OIDC/JWT mode is enabled without issuer/JWKS configuration.
  - Improve `forge dev` lifecycle diagnostics and port-busy recovery hints for
    agent-run app previews.

## 0.1.0-alpha.39

### Patch Changes

- Harden real WorkOS seed setup for production-like field tests.

  - Emit valid YAML for generated `workos-seed.yml` files by skipping the
    JavaScript-style deterministic header on YAML artifacts.
  - Make `forge workos seed --dry-run` the validation-only path and let
    `forge workos seed --file workos-seed.yml --json` delegate to the
    authenticated WorkOS CLI.
  - Treat known WorkOS duplicate-resource seed responses such as permission
    slugs already in use as an already-applied seed instead of a hard failure.
  - Ignore `.workos-seed-state.json` in newly scaffolded apps.

## 0.1.0-alpha.37

### Patch Changes

- Fix `forge deps upgrade-plan` for npm alias installs used by ForgeOS apps.

  - Record the real package name from package metadata in the generated package graph when a dependency is installed through an alias such as `forge: npm:forgeos@...`.
  - Resolve upgrade plans by either the real package name (`forgeos`) or the dependency alias (`forge`) while preserving install specs like `forge@npm:forgeos@0.1.0-alpha.37`.
  - Avoid attempting to resolve the unrelated public `forge@alpha` package when an app asks to upgrade its ForgeOS alias dependency.
  - Add regression coverage for aliased package graph entries where the import name and real npm package name differ.

## 0.1.0-alpha.36

### Patch Changes

- Smooth the alpha field-test loop after the Vendor Access app exercise.

  - Teach `forge deps upgrade-plan` to resolve npm alias dependencies such as `forge: npm:forgeos@alpha`, while preserving alias install specs like `forge@npm:forgeos@0.1.0-alpha.36` in generated upgrade plans.
  - Normalize `auth.md` runtime risk rendering so Commands and Risk/Approval metadata agree that commands default to `write`.
  - Add non-throwing command proof APIs through generated `client.commandResult(...)` and React `useCommandResult(...)`, so expected policy denials can be rendered as structured results instead of noisy unhandled browser failures.
  - Update the basic example schema/docs to use `organizations` as the root tenant table instead of a self-referential `tenants` root.

## 0.1.0-alpha.35

### Patch Changes

- Harden field-test regressions found while building WorkOS-style multi-tenant apps.

  - Resolve camelCase `ref:` targets such as `ref:accessRequests` to canonical SQL table names like `access_requests`, and report unknown refs before invalid SQL reaches PGlite.
  - Allow WorkOS-like local dev auth headers through dev-server CORS, including organization, membership, permissions, roles, and claims headers.
  - Teach the generated agent contract and capability map to recognize camelCase `ctx.db` aliases for snake_case tables.
  - Avoid printing fake `http://127.0.0.1:0` API URLs in `forge dev --port 0` startup diagnostics.

## 0.1.0-alpha.34

### Patch Changes

- Harden the ForgeOS app-building DX after the Vendor Access field test.

  - Make `forge workos doctor` and `forge workos seed --dry-run` app-aware by deriving active permissions and resource types from generated policies, data graph, agent contract, authored WorkOS policies, and `workos-seed.yml` instead of assuming onboarding-specific slugs.
  - Add strong diagnostics for unnamed runtime default exports so `export default command(...)` reports `FORGE_RUNTIME_EXPORT_NAME_REQUIRED` with a named-export fix hint before generated API, frontend bindings, or capability maps drift.
  - Extend local `devAuth` for React, Vue, generated clients, and runtime auth parsing with WorkOS-like `permissions`, `roles`, `claims`, `organizationId`, and `organizationMembershipId`.
  - Add nullable timestamp schema support through `timestamp?` / `nullable("timestamp")` and teach `forge check` to flag empty timestamp literals in commands, queries, and liveQueries.
  - Add `forge dev --detach`, `forge dev status`, `forge dev stop`, and command-specific `forge dev --help` with explicit DB/port examples for agent-run app previews.
  - Add `forge changed --commit-ready` and `forge handoff --commit-ready` so agents can stage exactly authored commit files while excluding generated and operational artifacts.
  - Add `forge test authz` for a cheap generated-contract proof of tenant scope, policy bindings, and capability-map authz coverage.
  - Expose static UI/UX readiness through `forge inspect ui --ergonomics`.

## 0.1.0-alpha.33

### Patch Changes

- Fix the Nuxt template smoke by adding the explicit `vue-tsc` dev dependency
  required by `nuxt typecheck`, so newly scaffolded `nuxt-web` apps can run
  `npm run typecheck` after install without manual package repair.

## 0.1.0-alpha.32

### Patch Changes

- Harden the alpha field-test loop after real Codex, WorkOS, PGlite, and app-server exercises.

  - Accept `create-forgeos-app --git` as a supported/no-op compatibility flag when git initialization is already handled by the scaffold path, and keep `npm create forgeos-app@alpha .` working from empty current directories.
  - Reject schema definitions that try to model `id` as a normal text field so generated SQL cannot silently create the wrong primary-key shape.
  - Fix tenant-scoped updates in the in-memory database adapter and bring memory timestamp behavior closer to PGlite by rejecting empty timestamp strings and returning `Date` objects for timestamp columns.
  - Improve smoke/generate drift diagnostics and keep `forge handoff` read-only with respect to generated artifacts.
  - Copy generated WorkOS seed data to a root-level `workos-seed.yml` for app DX, serve `HEAD /auth.md` and `HEAD /.well-known/oauth-protected-resource`, and make local-vs-production auth posture more explicit.
  - Normalize suggested Forge commands in framework checkouts so `agent`, `delta`, `studio`, `status`, `changed`, `handoff`, doctors, and WorkOS/auth helpers recommend `node bin/forge.mjs ...` instead of a possibly stale global `forge`.
  - Return structured JSON diagnostics for Delta/PGlite export/open failures instead of leaking raw PGlite stack output, and improve Windows/PGlite repair guidance.
  - Expand `forge ui audit` with static UX/auth-readiness warnings for missing semantic landmarks, unlabeled form controls, unnamed buttons, missing loading/error/empty states, and tenant/prod-auth apps that still only show local dev auth posture.

## 0.1.0-alpha.31

### Patch Changes

- Smooth the ForgeOS field-demo DX after the alpha.30 app-server and WorkOS exercises.

  - Add `forge baseline create` and `forge baseline status` so non-git template workspaces can establish a local baseline and get useful `forge changed` / `forge handoff` diffs instead of noisy filesystem inventories.
  - Add `forge auth status` and production-focused `forge auth prove --prod` output so `dev-headers` is clearly labeled as local-only while JWT/OIDC proofs show production auth posture.
  - Expand `forge doctor windows` with local PGlite store posture and cleanup guidance, including safer PGlite abort inspection that does not poison the surrounding process exit code.
  - Add `forge ui audit` and run it during `forge verify --smoke` when a web app is present, catching missing UI scenarios, missing stable Forge test IDs, and missing policy-denied coverage for sensitive routes.
  - Expand `forge ui audit` with static UX/auth-readiness warnings for missing semantic landmarks, unlabeled form controls, unnamed buttons, missing loading/error/empty states, and tenant/prod-auth apps that still only show local dev auth posture.
  - Bring the in-memory DB adapter closer to PGlite for timestamp fields by rejecting empty timestamp values and returning `Date` objects for `timestamp`/`timestamptz` columns.
  - Make `forge handoff` use a read-only generated-artifact check so preparing a handoff no longer rewrites `src/forge/_generated/**`, `forge.lock`, or generated `AGENTS.md` noise; `forge dev --once` still self-heals stale artifacts.
  - Allow `forge new .` / `npm create forgeos-app@alpha .` from an empty current directory, while refusing non-empty directories to avoid overwriting existing apps.

## 0.1.0-alpha.30

### Patch Changes

- Harden the WorkOS/AuthKit adapter and dev telemetry after the alpha.29 field app test.

  - Normalize WorkOS AuthKit `User` objects before generated auth routes pass them to Forge session and organization-resolution helpers, so apps typecheck against the WorkOS SDK without unsafe direct `Record<string, unknown>` casts.
  - Keep telemetry best-effort when a database adapter applies `INSERT ... RETURNING` but omits returned rows, preventing telemetry from surfacing as `FORGE_DEV_SERVER_ERROR`.
  - Add regression coverage for generated WorkOS adapter typechecking and telemetry inserts that return no rows.

## 0.1.0-alpha.29

### Patch Changes

- Add the first WorkOS/AuthKit adapter and local auth metadata tooling.

  - Add `forge add auth workos`, generated WorkOS seed/config/docs, AuthKit routes, webhook handling, JWT/OIDC claim mapping, and permission-derived Forge policies.
  - Add `forge authmd generate` and `forge authmd check`, including `/auth.md` and OAuth protected-resource metadata served by `forge dev`.
  - Add a local WorkOS/FGA testkit, resource-graph helpers, cross-tenant guards, FGA cache/fallback telemetry, and mock multi-tenant regression coverage.
  - Teach Forge auth and policies to understand permission claims alongside roles.
  - Add `forge version --json` as a command alias and capture local helper table reads in the generated agent contract/capability map.

## 0.1.0-alpha.28

### Patch Changes

- Accept visible Codex hook canaries as sufficient for local editing while reporting native Codex provenance separately through `nativeTrustStatus`.

## 0.1.0-alpha.27

### Patch Changes

- Stabilize `forge add convex` and generated integration artifacts.

  - Re-emit integration adapters, docs, and testkits from the main generator so `forge generate --check` and `forge verify --smoke` stay clean after `forge add`.
  - Keep partial `forge add` plans from deleting unrelated generated files before the full generator can reconcile the workspace.
  - Include changed package-manager files such as `package.json` and lockfiles in `forge add --json` handoffs.
  - Replace stale fast-check manifest hashes instead of merging them, and invalidate old manifest schemas to avoid phantom generated drift.
  - Skip Bun module mock registration when the active Bun runtime does not expose `Bun.mock.module`, while still applying mock secret env vars.
  - Filter generated and operational filesystem noise from `forge changed --authored` in non-git workspaces.
  - Keep Java build outputs such as `target/`, `.class`, and `.jar` files out of the published npm tarball.

## 0.1.0-alpha.26

### Patch Changes

- Harden the field-demo loop after the Team Onboarding app exercise.

  - Let `forge changed` and `forge handoff` summarize non-git workspaces with a filesystem inventory instead of reporting zero useful changes.
  - Keep `forge make resource` global by default unless a tenants table exists or `--tenant-scoped` is explicit.
  - Expand capability-map table detection for aliased `ctx.db` usage.
  - Wait through short-lived DeltaDB writer locks before reporting `FORGE_DELTA_BUSY`.

## 0.1.0-alpha.25

### Patch Changes

- Harden DeltaDB and Agent Memory under real `forge dev` concurrency.

  - Stop long-running dev recorders from holding the DeltaDB writer lock between events.
  - Retry short transient DeltaDB writer conflicts before reporting `FORGE_DELTA_BUSY`.
  - Keep Codex hook queue checkpoints unchanged when Agent Memory ingest is blocked by a busy DeltaDB writer, then retry safely instead of losing queued events.
  - Add watcher backoff metadata for lock recovery and document the safe queue/DeltaDB behavior.

- Fix tenant-scope reporting in the generated agent contract and capability map.

  - Match tenant-scoped tables by both authored/camelCase table names and generated SQL snake_case table names.
  - Report camelCase liveQuery dependencies such as `onboardingTasks` as `tenant` scoped when `tenantScope.json` confirms `tenant_id`.
  - Add regression coverage for the Team Onboarding style liveQuery/capability-map path.

## 0.1.0-alpha.24

### Patch Changes

- Consolidate the public alpha adoption surface and agent-contract positioning.

  - Add an explicit MIT `LICENSE`, package license metadata, and a private GitHub Security Advisory disclosure path.
  - Add stable-alpha, AI-coding, agent demo, Convex, and agent-eval documentation pages, plus a runner-agnostic eval task scaffold.
  - Fix `forge new --json` so scaffold automation receives structured JSON instead of human next-step text.
  - Add the first `forge add convex` app-contract recipe with runtime placement guardrails, optional Convex environment names, generated docs, and a mock testkit.
  - Expand field-report expectations and package/release tests for license, security disclosure, docs, create-app help, Convex recipes, and JSON scaffold output.

## 0.1.0-alpha.23

### Patch Changes

- Tighten the post-alpha.22 release surface and package evidence.

  - Add a dedicated Nuxt template smoke workflow that installs `nuxt-web`, runs Forge generation/checks, runs Nuxt typecheck, and probes `forge dev --once`.
  - Include `nuxt-web` in the default field-test template matrix.
  - Add explicit `scopeTarget` metadata and human-readable target output for `forge agent context --change`, `--proof`, and `--handoff`.
  - Teach `forge explain` to fall back to the current generated agent contract when DeltaDB has no runtime history, while marking the result as contract-defined instead of executed.
  - Downgrade read-only observation commands such as `forge status`, `forge changed`, `forge handoff`, `forge explain`, `forge timeline`, and CAIR queries to low-confidence context-gathering sessions in DeltaDB.
  - Package `docs/cair-protocol.md` in the npm tarball and expand the public security/threat-model docs for DeltaDB, agent memory, CAIR, Studio bridge, brownfield import, and Nuxt surfaces.

## 0.1.0-alpha.22

### Patch Changes

- Improve the post-alpha.21 agent workflow without adding new MCP tools.

  - Add `forge agent context` scopes for entry, change, proof, and handoff context packs.
  - Add DeltaDB verbose health details for queue redaction, operation age, semantic projection state, and overhead posture.
  - Add `forge delta compact`, `forge delta prune`, and redacted `forge delta export` for local Delta maintenance and support bundles.
  - Add `forge doctor delta` for recorder writability, queue drain, redaction, and gitignore checks.
  - Add Semantic Timeline summary data for stale proofs and causal chains.
  - Record CAIR snapshot/query/action activity as Delta timeline events without adding new MCP tools.
  - Add a Studio snapshot handoff block and a dedicated CAIR Protocol documentation page.
  - Add an official `nuxt-web` template with a Forge notes backend, client/server Nuxt plugins, a `useNotes` composable, a Nitro runtime-config route, and generated Vue composables.

## 0.1.0-alpha.21

### Patch Changes

- Harden Codex hook queue privacy and brownfield import classification.

  - Queue new Codex hook events as redacted payloads instead of storing raw prompts, tool inputs, tool responses, or transcripts in `.forge/agent/events.ndjson`.
  - Compact consumed hook queue history into redacted `.history` lines so old raw queue entries are not copied forward during drain retention.
  - Scope brownfield route classification to the detected route handler, so read-only GET handlers are not marked command-like because a sibling route in the same file writes state.
  - Mark read-shaped `POST /search`, `/query`, `/filter`, `/lookup`, and `/graphql` routes as `command-candidate` with `ambiguous-post-query` risk instead of treating them as normal writes.
  - Sync the public docs changelog/CLI reference and clarify the alpha/latest npm dist-tag policy.

## 0.1.0-alpha.20

### Patch Changes

- Fix generated-change diagnostics, Codex hook queue handling, and external stdio command parsing.

  - Classify generated `AGENTS.md` blocks and `.forge/agent/context.json` as derived artifacts in `forge changed`/`forge status`.
  - Skip probe, invalid, and out-of-workspace queued hook events during Agent Memory drain, and bound queue inspection for large hook queues.
  - Preserve empty stdio command arguments, diagnose malformed command strings, and support structured `service.commandArgs` in external manifests.
  - Include the basic example client demo in typecheck coverage.

## 0.1.0-alpha.19

Alpha hardening:

- Added the `agent-workroom` app template for Forge Studio style demos: external
  agents edit the app, while ForgeOS shows preview URL, agent signals, check
  runs, and handoff evidence through generated commands and liveQuery bindings.
- Added `forge studio attach` for Studio-style observer apps: writes `.forge/studio/attachment.json`, prepares external-agent adapters/hooks, and returns the target preview URL.
- Added `summary.preview` and `summary.urls.suggestedPreview` to `forge dev --once --json` so observer UIs can target the app under construction instead of pointing at themselves.
- Improved `forge dev` port-busy failures with a `port_busy` JSON failure kind and suggested recovery commands, including the common "Is port X in use?" startup error shape.
- `forge dev` now resolves the web app port before startup and automatically moves to the next available port when the default web port is busy, keeping the printed/JSON web URL truthful.
- Improved `forge check --json` next actions by surfacing diagnostic-specific repair/inspect commands instead of a generic last-test-run repair hint.
- Added `forge doctor agent --target <agent>` as the top-level agent readiness check.
- Added explicit `forge agent ingest <source> --watch --file <events.ndjson>` support for opt-in hook/export file ingestion.
- Added human-friendly verifier aliases: `forge verify quick`, `forge verify agent`, and `forge verify release`.
- Made `forge status --human` an explicit accepted spelling and documented `forge add <npm-package> --workspace web` as the normal package-add path.
- Made bare `forge inspect` default to the compact `summary` target instead of returning a usage error.
- Added `forge release doctor`, `release check --allow-missing-local-release`, and `self-host check --prepared-only` so release readiness can distinguish hard failures from not-yet-prepared local artifacts.
- Hardened the public packed-package smoke with dry-run mode, per-step JSON evidence, step timeouts, installed-global CLI coverage, hook smoke readiness, Studio open coverage, and preview-port cleanup checks.
- Expanded `forge docs check` with YAML shape checks, internal Markdown link validation, optional ReadTheDocs-style venv installation, and strict MkDocs build execution.
- Added authored-only review paths through `forge changed --authored` and `forge diff authored`, keeping generated artifacts collapsed unless explicitly requested.
- Added `forge delta status --verbose --json` for schema, lock, path, and aggregate-count diagnostics without expanding the default status payload.
- Added explicit hook readiness levels (`none`, `canary`, `trusted-native`) and documented `.codex/hooks.json` as versioned adapter configuration while keeping `.forge/agent/**` as local operational state.

## 0.1.0-alpha.18

Codex hook memory hardening:

- Hardened Codex hook ingestion by deriving useful tool-call metadata from the documented hook wire format while keeping raw prompts, tool inputs, tool responses, transcripts, and secrets out of Agent Memory.
- Added safe command summaries, tool-call ids, result status, exit codes, response summaries, inferred files, and inferred runtime entries for Codex `PreToolUse`, `PermissionRequest`, and `PostToolUse` events.
- Updated the Codex hook installer with hook timeouts and status messages, and added a local wrapper so repo hooks can use the checkout implementation.
- Documented the safe Codex hook metadata surface and added regression coverage for real hook payload shapes.

## 0.1.0-alpha.17

External runtime timeline metadata:

- Enriched DeltaDB runtime call recording for imported Go/Java/external services by reading generated `externalServices.json` metadata during `forge run` and `forge query`.
- `forge timeline` and `forge explain` now report external runtime `service`, `language`, `risk`, `policy`, `tenantScoped`, and `needsApproval` state instead of falling back to null/false values after successful external calls.
- Added a DeltaDB schema migration for `runtime_calls.needs_approval` and bumped the local DeltaDB schema to `0.3.1`.
- Added regression coverage for the real CLI recorder path so manifest-imported external commands keep semantic metadata in timelines.
- Promotes this release on npm as both `alpha` and `latest`.

## 0.1.0-alpha.16

Stability alignment:

- Fixed H47 `forge timeline` and `forge explain` crashes after large `artifact.generated` payloads by replacing unsafe JSON string truncation with a safe summary/hash envelope.
- Summarized generated artifact batches in the Semantic Timeline with count, hash, sample, and omitted count instead of embedding every artifact in timeline event data.
- Fixed H49 brownfield import detection for root-level Next.js App Router and Pages API routes such as `app/api/.../route.ts` and `pages/api/...`.
- Updated public CLI and DeltaDB docs for timeline/session/explain/MCP/agent-memory commands and clarified that `.forge/delta/delta.db` is a PGlite/Postgres data directory.
- Verified the release against a public GitHub `main` smoke app using `generate`, `check`, `delta status`, `timeline`, `explain`, `import analyze`, and `inspect imported`.

## 0.1.0-alpha.15

Brownfield import analysis:

- Added H49 `forge import analyze` and `forge import inspect` for static brownfield TypeScript/JavaScript app inventory.
- Detects Next.js App Router routes, Pages API routes, Express/Nest-style handlers, frontend `fetch`/`axios` calls, env usage, framework/data/external package signals, and conservative candidate command/query entries.
- Writes `.forge/import` artifacts including inventory, routes, frontend calls, candidate entries, risk report, migration plan, and imported agent contract.
- Keeps imported entries hidden from agents by default with `origin: imported`, `assurance: static-scan`, `reviewStatus: needs-review`, `visibleToAgent: false`, and approval required for command-like or risky entries.
- Added `forge inspect imported --json` plus focused H49 CLI and scanner coverage.

## 0.1.0-alpha.14

Java and Nuxt/Vue support:

- Added the Java external runtime adapter with a lightweight JDK HTTP bridge, manifest export, typed handlers, tenant/auth context, diagnostics, and command/query registration.
- Added a Spring Boot starter for Java services that want annotation-based Forge command/query exposure.
- Added the `java-billing` conformance example and packaged it with the public alpha line.
- Added generated Vue bindings and a `forgeos/vue` export with `provideForge`, `ForgeVuePlugin`, `useForgeQuery`, `useForgeCommand`, and `useForgeLiveQuery`.
- Added Nuxt UI scaffolding through `forge make ui --framework nuxt`, including plugin wiring, composable bridge files, and frontend graph detection for `.vue` routes/components.
- Updated docs, agent adapter guidance, generated manifests, and focused Java/Vue/Nuxt tests.
- Kept H44-H48 memory, sessions, timeline, grouping, and MCP surfaces intact while merging the Java/Nuxt work into `main`.

## 0.1.0-alpha.13

Agent Memory Bridge:

- Added the H48 Agent Memory Bridge alpha with redacted external agent event ingestion and normalized `forge.agent-event.v1` envelopes.
- Added Codex and Claude Code hook installers plus Cursor MCP/rules setup, all with raw prompts, completions, tool args, transcripts, and cloud sync off by default.
- Added `forge mcp serve` with context, memory, timeline, and inspect tools for external agents.
- Added `forge agent install`, `forge agent ingest`, `forge agent context`, and `forge agent memory` commands.
- Persisted external agent activity in DeltaDB and linked agent/tool/file events into the semantic timeline.
- Added focused privacy, ingest, MCP, installer, and CLI parse coverage for the H48 bridge.

## 0.1.0-alpha.12

Semantic Timeline:

- Added the H47 Semantic Timeline projection for DeltaDB with rebuildable timeline events, entity indexes, causal edges, and projection state.
- Upgraded `forge timeline` from a raw operation log view into an entity-oriented semantic timeline for runtime entries, policies, diagnostics, proofs, services, files, and sessions.
- Added proof staleness detection and causal links for denial -> policy repair -> successful execution flows.
- Updated `forge explain` to include semantic timeline context and current-state summaries when available.
- Documented the timeline projection/rebuild model and added focused DeltaDB coverage for runtime, policy, diagnostic, proof, and deterministic rebuild scenarios.

## 0.1.0-alpha.11

Strict verify performance:

- Reduced the validated `forge verify --strict` wall time from roughly 358-454s to about 116s on the current Windows test machine.
- Added stable repo-local `tsx` CLI caching under `node_modules/.cache/forge-tsx-cli` so spawned CLI tests reuse the warm compiler path.
- Balanced TestGraph strict execution across shared and isolated lanes, bringing the slowest files down from roughly 50s to under 10s in the updated profile.
- Moved heavy refactor/impact/external runtime suites onto faster shared paths where safe and kept isolation for process-sensitive tests.
- Documented and guarded the cache behavior so future test helpers preserve the speedup without checking cache contents into git.
- Added guarded alpha release workflow support for promoting the public `latest` dist-tag when npm token auth is configured.

## 0.1.0-alpha.10

Launch polish:

- Fixed `forge run <external-command> --args ...` so CLI arguments reach the external runtime bridge.
- Added direct external query CLI support through `forge query <service.query> --args ...`.
- Emit generated `.json` artifacts as pure JSON while keeping deterministic headers on code/text artifacts.
- Relaxed the `minimal-web` template verify script to `forge verify --smoke` and added the missing `check` script to `b2b-support-web`.
- Updated public protocol/changelog docs for the external runtime and Go adapter alpha line.
- Bumped the create-app wrapper package line to `create-forgeos-app@0.1.0-alpha.4`.

## 0.1.0-alpha.9

### Patch Changes

- Added the Forge external runtime protocol bridge for manifest-backed commands and queries.
- Added the Go adapter MVP with a real `go-billing` conformance example.
- Emitted external service metadata into inspect/API/agent artifacts, including `needsApproval` for agent tools.
- Reuse compiler classifier package signals across export classification, dropping repeated package signal scans.
- Reuse serialized graph JSON when rendering the largest generated TypeScript graph artifacts.
- Keep generated Forge artifacts aligned with the `0.1.0-alpha.9` compiler/runtime version.

## 0.1.0-alpha.8

### Patch Changes

- [`7568756`](https://github.com/Stahldavid/forge/commit/756875688873dd60d3d6cf700a7bb7c211968c69) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Publish prerelease packages through the ForgeOS alpha publisher so npm dist-tags stay aligned.

## 0.1.0-alpha.7

### Patch Changes

- [`4ace311`](https://github.com/Stahldavid/forge/commit/4ace3113e3298b5c306000870922fcfbae9c1861) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Keep npm prerelease publishing on the public alpha dist-tag.

## 0.1.0-alpha.6

### Patch Changes

- [`c30f906`](https://github.com/Stahldavid/forge/commit/c30f9069c99ac747ce143ab5fbcbf13912ed8760) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add CLI version output, align create-app help with package metadata, and add release dependency audit evidence.

## 0.1.0-alpha.5

Release alignment for the public alpha channel:

- Added `forge ai redteam --model-level --json` with deterministic prompt-injection, secret-exfiltration, approval-bypass, cross-tenant, and indirect tool-injection probes.
- Added `forge security prove --full --json` support for source checkouts, with graceful structural-proof fallback when packaged apps do not include ForgeOS test fixtures.
- Strengthened npm publish workflows to run `security prove --db postgres --full --json`.
- Added public registry smoke coverage for `forgeos@alpha` and `create-forgeos-app@alpha`.
- Bumped the create-app wrapper package line to `create-forgeos-app@0.1.0-alpha.1`.

## 0.1.0-alpha.4

Security assurance and release evidence hardening:

- Added value-aware telemetry redaction for known secret values in safe-looking fields, messages, details, outputs, and stack traces.
- Added webhook signature, timestamp, and replay protection helpers with Stripe/GitHub/generic HMAC coverage.
- Added HTTP tenant-isolation tests that exercise the dev server/API boundary, not only the internal runtime executor.
- Added `forge rls mutate-test --json` to kill dangerous generated RLS mutations such as missing FORCE RLS, missing policies, unconditional predicates, and `BYPASSRLS`.
- Extended `forge security prove --json` with RLS mutation proof and invariant-level evidence metadata.
- Added scripts to split security evidence by invariant and emit basic release supply-chain evidence plus CycloneDX SBOM.
- Strengthened publish/security workflows so release gates use Postgres-backed security proof, RLS mutation proof, release evidence, and SBOM generation.

## 0.1.0-alpha.3

Native Forge AI agents on top of Vercel AI SDK v6:

- Added `aiTool` and `agent` primitives with generated `agentTools.json` / `agentTools.md`.
- Added `ctx.agent.run` and `ctx.ai.runAgent` using AI SDK `ToolLoopAgent`.
- Added auto-tools for commands, queries, and liveQueries with read-only vs approval-required writes.
- Added dev agent endpoints: `POST /ai/agents/run` and `POST /ai/agents/chat`.
- Extended `forge ai` CLI with `tools`, `agents`, and `trace` subcommands.
- Added `forge inspect agent-tools` and agent tool metadata in `agentContract.json`.
- Upgraded runtime dependency to AI SDK v6 for tool calling, streaming UI, and MCP compatibility.

Documentation:

- Added public [AI](https://forgeos.readthedocs.io/en/latest/ai/) page and AST-aware `rename command` codemod docs.
- Expanded ReadTheDocs to full agent-native coverage: agent workflow (`forge do`), frontend/liveQuery, security/data, authoring, testing/repair, self-host, templates, Material theme, and changelog page.

## 0.1.0-alpha.2

Windows and generated-app hardening:

- Fixed Node ESM handler loading on Windows by importing generated app modules
  through `file://` URLs across commands, queries, liveQueries, outbox actions,
  workflow steps, mocks, and telemetry adapters.
- Fixed `forge dev` SSE streaming on the Node HTTP fallback so liveQuery
  snapshots are flushed immediately instead of buffering forever.
- Hardened generated app scaffolding and web dev spawning on Windows.
- Updated the B2B support template to route frontend imports through
  `web/lib/forge.ts` and use safer handler input validation.
- Added focused tests for Node compatibility, template scaffolding, runtime
  imports, and streaming responses.

## 0.1.0-alpha.1

Republish alpha with the dependency/API oracle improvements:

- Added dependency API inspection commands for agents:
  `forge deps api`, `forge deps trace`, and `forge deps runtime-compat`.
- Added dependency API summaries to `agentContract.json`.
- Added package resolution traces, runtime compatibility metadata, and
  runtime/type mismatch diagnostics to `packageGraph`.
- Reduced package graph warning noise for `package.json` metadata exports,
  declaration-file subpaths, and pattern exports.

## 0.1.0-alpha.0

Initial alpha packaging baseline for ForgeOS.

This release line is intended to validate npm installation, the `forge` CLI binary,
template creation, generated contracts, and the agent-native local development loop.

Added ReadTheDocs-ready public documentation, generator/package version alignment
checks, and a broad generated-app field-test harness for release hardening.
