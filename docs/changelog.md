# Changelog

Release history for the `forgeos` npm package.

The canonical source file in the repository is `CHANGELOG.md`.

## Unreleased

## 0.1.0-alpha.48

- Added the production-shaped WorkOS FGA flow:
  `forge workos fga plan`, `sync`, `prove`, and `doctor` now derive an FGA
  manifest from the app contract, policies, data graph, and `workos-seed.yml`.
- `forge workos fga sync --real` and `forge workos fga prove --real` can use
  the authenticated WorkOS CLI/API path when `WORKOS_API_KEY` is not available,
  so agents can continue the no-dashboard flow after `workos auth login`.
- FGA setup output now separates hosted WorkOS resource-type configuration from
  ForgeOS-automated resource sync and authorization checks, and reports missing
  resource types with exact next actions.
- `forge deploy check --production` now requires matching WorkOS FGA real
  sync/proof evidence for WorkOS-backed apps and points operators at
  `forge workos fga plan --write`, `sync --real`, and `prove --real`.
- WorkOS seed generation now keeps inferred parent resource relationships such
  as `access_request -> vendor`, with regression coverage for the generated
  seed, parser, deploy checks, and FGA plan output.

## 0.1.0-alpha.47

- `forge workos setup --real` and `forge workos prove --real` now validate the
  real OIDC/JWT and WorkOS environment before hosted setup, surfacing exact
  failed checks like `setup:real-env-forge_auth_audience`.
- `forge deploy check --production` now requires WorkOS-backed apps to include
  hosted seed evidence in `.workos-seed-state.json` matching the current
  `workos-seed.yml`, with a direct `forge workos prove --real --file
  workos-seed.yml --json` remediation.
- Clarified production, self-host, and field-test docs so local mock evidence,
  hosted WorkOS seed evidence, and production deploy env evidence are treated
  as separate gates.

## 0.1.0-alpha.46

- `forge deps upgrade-apply` and `forge deps upgrade-rollback` now accept the
  `planDir` returned by `forge deps upgrade-plan`, resolving it to the nested
  `plan.json` automatically.
- Invalid upgrade plan directories now return a precise
  `FORGE_DEPS_TARGET_NOT_FOUND` diagnostic with suggested commands instead of a
  generic JSON parse failure.
- Added regression coverage for plan-directory apply behavior and missing
  `plan.json` diagnostics.

## 0.1.0-alpha.45

- `forge workos setup/prove --real` now passes the top-level unknown-option
  guard, matching the documented no-dashboard WorkOS apply flow.
- `forge workos seed --file workos-seed.yml --json` now treats known WorkOS
  duplicate-resource responses as explicit idempotency, suppressing duplicate
  stderr in successful JSON output while recording `seedAlreadyAppliedReason`
  and seed state.
- `forge field-test run` now uses an async harness process with periodic
  progress heartbeats on stderr so realistic probes do not appear stuck.
- `forge deploy check --production` now reports sanitized env-source evidence,
  including which production keys were found or missing, while keeping `.env`
  and `.env.local` clearly marked as local guidance rather than production
  deploy evidence.

## 0.1.0-alpha.44

- `forge inspect ui --ergonomics` now treats helper-based seed recovery inside
  `useEffect` as valid automatic first-run recovery, fixing a false
  `FORGE_UI_AUTO_SEED_RECOVERY_MISSING` warning in the `vendor-access`
  template.
- Added template regression coverage so `vendor-access` keeps its seed
  controls, auto-seed UI scenario, and zero-warning ergonomics evidence in sync
  with `forge field-test run --realistic`.

## 0.1.0-alpha.43

- Included `scripts/field-test-forgeos.mjs` in the published npm package so
  `forge field-test run` works from generated apps installed from
  `forgeos@alpha`, not only from the ForgeOS framework checkout.
- `forge field-test run` now resolves the harness from the current workspace
  first and then from the installed ForgeOS package, with a clearer diagnostic
  listing searched paths when neither location exists.
- Added regression coverage for running the field-test command from an app
  workspace that does not contain a local `scripts/field-test-forgeos.mjs`.

## 0.1.0-alpha.42

- Added the golden-path CLI alias `forge field-test run --realistic`, which
  enables runtime, auth, and UI probes together and defaults to the
  WorkOS-backed `vendor-access` path when no template/auth override is
  provided.
- Added `forge deploy package --target docker` as the user-facing production
  packaging command while keeping `forge deploy render docker` compatible; the
  generated production README and deploy plan now point at `package`.
- Added `forge workos prove --file workos-seed.yml --json` as an aggregate
  no-dashboard proof for WorkOS/AuthKit/FGA/seed readiness, with `--real`
  applying hosted setup through the existing WorkOS CLI integration.
- `forge field-test report` now requires zero UI ergonomics warnings before
  marking a UI-probed report ready for deploy checks, so product-surface
  problems like demo copy, raw fetch errors, or exposed dev diagnostics cannot
  pass as production-ready evidence.
- `forge inspect ui --ergonomics` now warns when a production-auth/WorkOS app
  exposes local persona or dev-auth controls without explicitly separating
  them as local development mode, reducing confusion between mock identity and
  real AuthKit/OIDC auth.
- UI scenarios now support a `selectOption` step and the `vendor-access`
  template generates browser scenarios for local sign-in, requester approval
  denial, first-run seeded vendor data, and seed/reset controls, so field tests
  can cover role-specific product flows instead of only loading `/`.
- `forge field-test report` now treats those `vendor-access` UI scenarios as
  deploy-readiness evidence, requiring local sign-in, seeded-data,
  requester-denied, and seed-control scenario names whenever UI probes run for
  the template.
- `forge inspect ui --ergonomics` now warns with
  `FORGE_UI_AUTO_SEED_RECOVERY_MISSING` when demo/sample seed commands exist
  but the frontend does not appear to auto-recover an empty first-run
  workspace, catching apps that open on an unseeded or broken-looking state.
- `forge ui doctor` and UI scenario runs now resolve Playwright from the app or
  `web/` package root, infer npm/pnpm/bun/yarn setup commands from lockfiles,
  and distinguish missing installs from missing Playwright dependencies instead
  of always suggesting Bun commands.
- `forge field-test report` now treats `vendor-access` seed readiness as
  deploy-ready only when `seed status` proves `autoSeedMode: "all-tenants"`,
  catching regressions where domain probes pass but `npm run dev` would still
  warm only the default tenant.
- `forge seed dev --all-tenants` and `forge seed reset --all-tenants` now
  preserve successful per-tenant warnings in the aggregate `diagnostics`
  payload, deduplicating repeated warning codes/messages while keeping full
  per-tenant diagnostics under `tenantRuns`.
- `forge seed status` now warns with `FORGE_SEED_DEV_PARTIAL_TENANTS` when an
  app exposes multiple local tenant/persona profiles but `npm run dev` only
  uses `forge dev --seed` without `--all-tenants`, and it promotes
  `forge dev --seed --all-tenants` as the first empty-workspace recovery.
- `forge dev --seed` startup summaries now surface seed warnings even when the
  seed command itself succeeds, so partial multi-tenant seeding is visible in
  the first dev-server payload and human terminal output.
- `forge seed status --json`, `forge dev --seed --json`, and field-test
  reports now expose `autoSeedMode` (`none`, `default-tenant`, or
  `all-tenants`) alongside the compatibility booleans `autoSeedOnDev` and
  `autoSeedAllTenantsOnDev`, making it obvious when `npm run dev` warms every
  discovered local tenant/persona instead of only the default tenant.
- The `vendor-access` starter now runs `forge dev --seed --all-tenants` from
  `npm run dev`, so Acme and Globex local workspaces are warmed up by default
  instead of leaving secondary tenant views empty until manual seeding.
- Human `forge dev --seed --all-tenants` startup output now lists per-tenant
  seed results with labels and HTTP status, matching the structured startup
  JSON evidence without requiring agents to rerun with `--json`.
- `forge inspect ui --ergonomics` now warns when a WorkOS/AuthKit frontend is
  mounted but does not expose normalized `/session` claims or proxy the AuthKit
  login/callback/logout/session routes, catching half-wired production auth
  flows before browser testing.
- `forge inspect ui --ergonomics` now warns when Forge/WorkOS operational
  diagnostics such as env names, seed files, claims dumps, capability maps, or
  policy proofs appear in the primary product surface instead of a collapsible
  developer panel.
- `forge inspect ui --ergonomics` now requires WorkOS-authenticated apps to
  expose a visible WorkOS/AuthKit sign-in/sign-out path, `/login`/`/logout`
  link, or AuthKit signIn/signOut call, so local-persona buttons or
  organization/session copy alone no longer count as a real WorkOS auth flow.
- `forge workos seed --file ... --json` now writes a local
  `.workos-seed-state.json` after successful hosted seed application or known
  duplicate-resource/idempotent WorkOS responses, giving agents a stable,
  secret-free proof that the seed was applied or already present.
- `forge workos doctor --json` and `forge workos seed --dry-run --json` now
  read `.workos-seed-state.json`, report whether it matches the current
  `workos-seed.yml`, and surface seed drift before an agent reapplies hosted
  WorkOS changes.
- `forge workos setup --json` now surfaces the same seed-state summary at the
  top level for dry-runs and real no-dashboard setup runs, so agents can see
  hosted seed drift without digging through nested seed payloads.
- Human `forge workos setup --real` output now reports whether
  `.workos-seed-state.json` matches the current seed after hosted setup,
  keeping text-mode CLI handoffs aligned with JSON evidence.
- `forge workos doctor --json` now includes structured WorkOS coverage data
  (`seed`, `seedState`, active policy permissions, expected resource types, and
  missing/unused seed coverage) so agents can verify auth setup without parsing
  human check text.
- `forge seed status --json` now reports seed readiness, including the selected
  seed command, default local dev-auth headers, whether `npm run dev` already
  auto-seeds through `forge dev --seed`, and exact recovery commands for empty
  workspaces.
- `forge seed status --json` now discovers local frontend tenant/persona
  profiles and emits per-tenant `forge seed dev`/`forge seed reset` commands,
  making multi-tenant field apps easier to warm up and test without guessing
  Acme/Globex headers.
- `forge seed dev --all-tenants` and `forge seed reset --all-tenants` now run
  the selected seed command against every discovered local tenant/persona,
  returning per-tenant request/response evidence for multi-tenant field tests.
- The `vendor-access` field-test runtime probe now uses
  `forge seed dev --all-tenants` and accepts that single bulk-seed proof as the
  deploy-readiness seed evidence, while still accepting older Acme/Globex
  per-tenant report artifacts.
- `forge dev --seed --all-tenants` now forwards the discovered local
  tenant/persona set into startup seeding and includes per-tenant seed run
  evidence in the dev startup JSON summary.
- Generated-drift JSON now includes a concurrency note and normalized
  sequential `generate`/`generate --check` commands, so agents do not mistake a
  parallel `forge generate`/`forge generate --check` race for a persistent
  generator defect.
- `forge dev --seed` startup output now includes the same seed readiness block
  in `summary.seed.readiness`, so Studio and coding agents can diagnose empty
  workspaces from the first dev-server payload.
- `forge seed` now normalizes recovery and diagnostic commands for the current
  workspace, so framework checkouts show `node bin/forge.mjs ...` while
  generated apps continue to show `forge ...`.
- `forge seed status` now recognizes auto-seeded dev scripts whether they call
  `forge dev --seed`, `npm run forge -- dev --seed`, or the local
  `bin/forge.mjs dev --seed` entrypoint.
- Human `forge seed` output now prints an `empty workspace recovery` section
  with the same workspace-normalized commands exposed in JSON readiness.
- `forge field-test report` now treats `vendor-access` seed readiness as
  deploy-check evidence, so reports must prove the app exposes deterministic
  empty-workspace recovery commands before they are marked deploy-ready.
- Cleaned the `vendor-access` starter's local identity naming so the app uses
  `LocalPersona`/workspace seed terminology instead of demo-auth terminology in
  its authored frontend code and audit seed copy.
- `forge add auth workos` now treats already-declared WorkOS packages as an
  idempotent no-op for package installation, emits
  `FORGE_ADD_PACKAGE_ALREADY_DECLARED`, and continues adapter/AuthKit generation
  instead of surfacing a misleading install failure.
- `forge add auth workos` now generates a browser session helper and rewrites
  the `vendor-access` WorkOS shell to read normalized `/session` claims for
  organization, role, and permissions. Vite/Next templates now proxy `/session`
  alongside `/login`, `/callback`, and `/logout`.
- `forge workos doctor` now verifies the generated browser AuthKit bridge
  exposes `useForgeWorkOSSession` and that web dev config proxies `/session`
  with the AuthKit login/logout/callback routes, catching half-wired WorkOS
  apps before browser testing.
- `forge workos doctor` and `forge workos seed` now report unused seed
  permissions against the app's active policy permissions, making generic or
  stale seed files visible without blocking intentionally broader seeds.
- `forge check` now fails fast on `defineTable(..., { id: "text" })` with
  `FORGE_DB_INVALID_ID_FIELD`, before the app reaches confusing SQL/runtime
  primary-key behavior. Omit `id` for generated UUID ids or use `id: "uuid"`.
- Field-test runtime probes now start `forge dev` with `--port 0` and
  `--web-port 0`, then read the concrete API/web URLs from startup JSON instead
  of pre-reserving ports in the harness.
- Hardened `forge inspect ui --ergonomics` so generated apps with runtime
  commands/policies warn when they lack an obvious primary workflow action,
  workflow navigation, permission feedback, or when ForgeOS/demo copy appears
  in the main product surface instead of a collapsible dev panel.
- Tightened seed UX auditing so command names such as `seedVendorAccessDemo`
  no longer count as a visible first-run recovery path; apps with seed commands
  now need an actual seed/reset/status control or tenant-data recovery copy.
- Expanded UI ergonomics checks to catch `powered by ForgeOS` and
  `ForgeOS ... demo` copy on the product surface, and cleaned starter template
  first screens so generated apps open as useful products rather than framework
  advertisements.
- Reduced UI auth-flow false positives: apps that merely support `jwt`/`oidc`
  modes no longer look production-authenticated unless they set an active
  production auth mode, use tenant-scoped data, or include a WorkOS integration.
- Updated the `minimal-web` starter with real workflow navigation and section
  anchors so new apps no longer start with a UI ergonomics navigation warning.
- Made the `vendor-access` starter run `forge dev --seed` by default, with
  `dev:no-seed` available for empty-state debugging.
- Fixed the `vendor-access` README quickstart so it tells users to run the
  auto-seeded `npm run dev` script instead of appending a duplicate `--seed`
  flag.
- Tightened the `vendor-access` dashboard queries so the root organization
  record is loaded by the active tenant id instead of listing every demo
  organization in the workspace.
- Strengthened the `vendor-access` field-test probes to fail when the
  dashboard payload leaks the other tenant's root organization record, not just
  the other tenant's vendors.
- Made the `vendor-access` starter retry automatic demo seeding after transient
  frontend/API failures instead of marking a tenant as seeded before the seed
  command succeeds.
- Hardened `forge field-test report` production evidence so
  `readyForDeployCheck` requires concrete runtime health/entries probes, auth
  setup commands, auth metadata endpoint probes, a web UI probe, and UI
  ergonomics evidence instead of trusting enabled probe flags alone.
- Aligned `forge deploy check --production` with the stricter field-test
  evidence contract, including explicit missing-evidence messages for runtime,
  auth setup, auth metadata, UI, and ergonomics probes.
- Improved `forge add auth workos` for the `vendor-access` starter so real
  WorkOS browser config bypasses the local identity selector and renders an
  AuthKit-backed app shell, while retaining explicit local identity mode when
  WorkOS env vars are absent.
- Simplified the `vendor-access` local login surface to a persona picker plus
  local-mode continue action instead of a fake email/password form, making the
  boundary between dev-header simulation and real WorkOS/AuthKit login clearer.
- Tightened UI ergonomics around auth demos: `forge inspect ui --ergonomics`
  now warns on demo-login language and fake password-style auth forms in the
  primary app shell, and the `vendor-access` template labels local identity and
  workspace seed controls without fake credential copy.
- Field-test reports created with `--ui-probes` now include UI ergonomics audit
  evidence, and `forge deploy check --production` requires that evidence while
  surfacing UX warnings separately from runtime/auth failures.
- Field-test UI probes now reject obvious broken first-screen HTML such as
  `Failed to fetch`, `No organization seeded`, and raw Forge runtime errors
  instead of treating any reachable Vite/Next/Nuxt shell as product evidence.
- `forge field-test report` now requires the `vendor-access` app's concrete
  multi-tenant domain probes before marking field-test evidence deploy-ready:
  seed Acme/Globex, query both tenants, allow owner approval, deny requester
  approval, and deny cross-tenant approval.

## 0.1.0-alpha.41

- Fixed package install detection for npm workspace apps that hoist frontend
  dependencies. `forge add auth workos` now recognizes
  `@workos-inc/authkit-react` when it is installed for `web/` but resolved from
  an ancestor `node_modules`.

## 0.1.0-alpha.40

- Completed the WorkOS/AuthKit production-like app setup loop, including
  no-dashboard WorkOS setup, browser AuthKit doctor checks, generated Vite React
  AuthKit bridge, production auth readiness checks, and improved dev lifecycle
  diagnostics.

## 0.1.0-alpha.39

- Hardened real WorkOS seed setup: generated `workos-seed.yml` files no longer
  use `// @forge-generated` headers, `forge workos seed --dry-run` is the
  validation-only path, real seed runs handle known duplicate-resource WorkOS
  responses as already-applied state, and scaffolded apps ignore
  `.workos-seed-state.json` by default.

## 0.1.0-alpha.38

- Added first-class production deployment commands:
  `forge deploy plan`, `forge deploy render docker`,
  `forge deploy check --production`, and
  `forge deploy verify --production`.
- Generated Docker deployment files now use the app's detected package manager,
  require the matching lockfile for production checks, read
  `deploy/.env.production`, and avoid hidden hard-coded `DATABASE_URL`
  overrides.
- Added `forge field-test create`, `forge field-test run`, and
  `forge field-test report`, including runtime/auth probe summaries and
  `productionEvidence` so field-test reports can feed
  `forge deploy check --production`.
- Split `forge release doctor` into npm publish readiness and production deploy
  readiness, so package publishing is not confused with a production-ready app
  claim.
- Made `forge handoff --json` include commit-ready files by default, excluding
  generated and operational artifacts while reporting how much noise was
  filtered out.
- Clarified local auth versus production auth with `forge auth status` posture
  classifications, local `x-forge-*` header reporting, and production proof
  next actions.
- Added `dbGuide` to `forge doctor runtime` and `forge doctor pglite` so agents
  know when to use `--db memory`, `--db pglite`, stop an active process, or run
  local PGlite repair.
- Updated production, self-host, field-test, security, troubleshooting, and CLI
  docs to reflect the new deploy/auth/database workflow.

## 0.1.0-alpha.37

- Fixed `forge deps upgrade-plan` for npm alias installs used by ForgeOS apps.
- Recorded the real package name from package metadata in generated package
  graph entries when a dependency is installed through an alias such as
  `forge: npm:forgeos@...`.
- Resolved upgrade plans by either the real package name (`forgeos`) or the
  dependency alias (`forge`) while preserving install specs like
  `forge@npm:forgeos@0.1.0-alpha.37`.
- Avoided attempting to resolve the unrelated public `forge@alpha` package when
  an app asks to upgrade its ForgeOS alias dependency.
- Added regression coverage for aliased package graph entries where the import
  name and real npm package name differ.

## 0.1.0-alpha.36

- Smoothed the alpha field-test loop after the Vendor Access app exercise.
- Taught `forge deps upgrade-plan` to resolve npm alias dependencies such as
  `forge: npm:forgeos@alpha`, while preserving alias install specs like
  `forge@npm:forgeos@0.1.0-alpha.36` in generated upgrade plans.
- Normalized `auth.md` runtime risk rendering so Commands and Risk/Approval
  metadata agree that commands default to `write`.
- Added non-throwing command proof APIs through generated
  `client.commandResult(...)` and React `useCommandResult(...)`, so expected
  policy denials can be rendered as structured results instead of noisy
  unhandled browser failures.
- Updated the basic example schema/docs to use `organizations` as the root
  tenant table instead of a self-referential `tenants` root.

## 0.1.0-alpha.35

- Hardened field-test regressions found while building WorkOS-style
  multi-tenant apps.
- Resolved camelCase `ref:` targets such as `ref:accessRequests` to canonical
  SQL table names like `access_requests`, and reported unknown refs before
  invalid SQL reaches PGlite.
- Allowed WorkOS-like local dev auth headers through dev-server CORS,
  including organization, membership, permissions, roles, and claims headers.
- Taught the generated agent contract and capability map to recognize
  camelCase `ctx.db` aliases for snake_case tables.
- Avoided printing fake `http://127.0.0.1:0` API URLs in
  `forge dev --port 0` startup diagnostics.

## 0.1.0-alpha.34

- Hardened the ForgeOS app-building DX after the Vendor Access field test.
- Made `forge workos doctor` and `forge workos seed --dry-run` app-aware by
  deriving active permissions and resource types from generated policies, data
  graph, agent contract, authored WorkOS policies, and `workos-seed.yml`
  instead of assuming onboarding-specific slugs.
- Added strong diagnostics for unnamed runtime default exports so
  `export default command(...)` reports `FORGE_RUNTIME_EXPORT_NAME_REQUIRED`
  with a named-export fix hint before generated API, frontend bindings, or
  capability maps drift.
- Extended local `devAuth` for React, Vue, generated clients, and runtime auth
  parsing with WorkOS-like `permissions`, `roles`, `claims`, `organizationId`,
  and `organizationMembershipId`.
- Added nullable timestamp schema support through `timestamp?` /
  `nullable("timestamp")` and taught `forge check` to flag empty timestamp
  literals in commands, queries, and liveQueries.
- Added `forge dev --detach`, `forge dev status`, `forge dev stop`, and
  command-specific `forge dev --help` with explicit DB/port examples for
  agent-run app previews.
- Added `forge changed --commit-ready` and `forge handoff --commit-ready` so
  agents can stage exactly authored commit files while excluding generated and
  operational artifacts.
- Added `forge test authz` for a cheap generated-contract proof of tenant
  scope, policy bindings, and capability-map authz coverage.
- Exposed static UI/UX readiness through `forge inspect ui --ergonomics`.

## 0.1.0-alpha.33

- Fixed the Nuxt template smoke by adding the explicit `vue-tsc` dev
  dependency required by `nuxt typecheck`, so newly scaffolded `nuxt-web` apps
  can run `npm run typecheck` after install without manual package repair.

## 0.1.0-alpha.32

- Accepted `create-forgeos-app --git` as a supported/no-op compatibility flag
  when git initialization is already handled by the scaffold path, and kept
  `npm create forgeos-app@alpha .` working from empty current directories.
- Added stronger schema validation for `id` so apps cannot accidentally model
  the primary key as a normal text field and generate incorrect SQL.
- Fixed tenant-scoped updates in the in-memory database adapter and made memory
  timestamp handling closer to PGlite by rejecting empty timestamp strings and
  returning `Date` objects for timestamp columns.
- Improved smoke/generate drift diagnostics and kept `forge handoff` read-only
  with respect to generated artifacts.
- Improved WorkOS/auth app DX: root-level `workos-seed.yml`, `HEAD /auth.md`,
  `HEAD /.well-known/oauth-protected-resource`, and clearer local-vs-production
  auth posture.
- Normalized suggested Forge commands in framework checkouts so `agent`,
  `delta`, `studio`, `status`, `changed`, `handoff`, doctors, and WorkOS/auth
  helpers recommend `node bin/forge.mjs ...` instead of a possibly stale global
  `forge`.
- Returned structured JSON diagnostics for Delta/PGlite export/open failures
  instead of raw PGlite stack output, and expanded Windows/PGlite repair hints.
- Expanded `forge ui audit` with static UX/auth-readiness warnings for missing
  semantic landmarks, unlabeled form controls, unnamed buttons, missing
  loading/error/empty states, and tenant/prod-auth apps that still only expose
  local dev auth posture.

## 0.1.0-alpha.31

- Added Forge workspace baselines for non-git app directories:
  `forge baseline create` records a local baseline and `forge changed` /
  `forge handoff` can now report baseline diffs instead of noisy full
  filesystem inventories.
- Added `forge auth status` and production-aware `forge auth prove --prod`
  posture checks so local `dev-headers` auth is clearly distinguished from
  JWT/OIDC production authentication.
- Expanded `forge doctor windows` with local PGlite store posture and cleanup
  guidance, and made PGlite abort inspection preserve the surrounding process
  exit code.
- Added `forge ui audit` and wired it into `forge verify --smoke` for web apps
  to catch missing route scenarios, missing stable Forge test IDs, and missing
  policy-denied coverage for sensitive flows. It now also reports static
  UX/auth-readiness warnings for missing semantic landmarks, unlabeled form
  controls, unnamed buttons, missing loading/error/empty states, and
  tenant/prod-auth apps that still only expose local dev auth posture.
- Brought the in-memory DB adapter closer to PGlite for timestamp fields by
  rejecting empty timestamp values and returning `Date` objects for
  `timestamp`/`timestamptz` columns.
- Made `forge handoff` use a read-only generated-artifact check so preparing a
  handoff no longer rewrites `src/forge/_generated/**`, `forge.lock`, or
  generated `AGENTS.md` noise; `forge dev --once` still self-heals stale
  artifacts.
- Allowed `forge new .` / `npm create forgeos-app@alpha .` from an empty
  current directory, while refusing non-empty directories to avoid overwriting
  existing apps.

## 0.1.0-alpha.30

- Hardened the WorkOS/AuthKit adapter and dev telemetry after the alpha.29
  field app test.
- Generated WorkOS AuthKit routes now normalize SDK `User` objects before
  passing them into Forge session and organization-resolution helpers, so apps
  typecheck cleanly against the WorkOS SDK without unsafe direct
  `Record<string, unknown>` casts.
- Telemetry is now best-effort when a database adapter applies
  `INSERT ... RETURNING` but omits returned rows, preventing telemetry from
  surfacing as `FORGE_DEV_SERVER_ERROR`.
- Added regression coverage for generated WorkOS adapter typechecking and
  telemetry inserts that return no rows.

## 0.1.0-alpha.29

- Added the first WorkOS/AuthKit adapter surface: `forge add auth workos`
  generates local AuthKit wiring, `.env.example`, `workos-seed.yml`, demo
  organizations, roles, permissions, redirect/CORS/webhook hints, JWT/OIDC
  claim mapping, and permission-derived Forge policies.
- Added `forge authmd generate` and `forge authmd check`, including
  `public/auth.md`, OAuth protected-resource metadata, command/policy/tenant
  requirements, approval metadata, and `forge dev` serving for `/auth.md` and
  `/.well-known/oauth-protected-resource`.
- Added local WorkOS/FGA scaffolding without requiring real WorkOS credentials:
  resource graph helpers, cross-tenant guards, FGA check cache/fallback
  telemetry, a mock WorkOS testkit, and Acme/Globex multi-tenant regression
  coverage.
- Taught Forge auth and policies to evaluate permission claims alongside
  roles, including dev-header permission simulation.
- Added `forge version --json` as a command alias and improved the generated
  agent contract/capability map so table reads performed by imported local
  helpers are captured.

## 0.1.0-alpha.28

- Accepted visible Codex hook canaries as sufficient for local editing while
  reporting native Codex provenance separately through `nativeTrustStatus`, so
  `waiting-for-user-trust` no longer implies missing user approval when the
  canary path is already working.
- Added regression coverage and docs for the split between hook approval,
  canary readiness, and trusted native Codex signal proof.

## 0.1.0-alpha.27

- Stabilized the `forge add convex` loop: integration docs/testkits are now
  re-emitted by the main generator, partial `forge add` plans no longer remove
  unrelated generated files, stale fast-check manifest hashes are pruned instead
  of merged, and `forge add --json` includes changed package-manager files.
- Made runtime mock mode tolerate Bun builds without `Bun.mock.module` while
  still applying mock secret environment variables.
- Filtered generated and operational filesystem noise from
  `forge changed --authored` in non-git workspaces.
- Excluded Java build outputs such as `target/`, `.class`, and `.jar` files
  from the published npm tarball.

## 0.1.0-alpha.26

- Hardened the field-demo loop after the Team Onboarding app exercise:
  non-git workspaces now get a filesystem-backed `changed`/`handoff` summary,
  `forge make resource` stays global unless tenant scope is explicit or already
  modeled, capability-map extraction sees aliased `ctx.db` table usage, and
  Agent Memory waits through short-lived DeltaDB writer locks before reporting
  `FORGE_DELTA_BUSY`.

## 0.1.0-alpha.25

- Hardened DeltaDB and Agent Memory for concurrent `forge dev` usage:
  dev recorders now release the writer lock between events, Agent Memory ingest
  retries short transient writer conflicts, and queued Codex hook events keep
  their checkpoint unchanged when DeltaDB is temporarily busy.
- Fixed tenant-scope reporting in the generated agent contract and capability
  map for camelCase authored tables such as `onboardingTasks`, so liveQuery
  dependencies now report `tenant` scope when `tenantScope.json` confirms the
  table is tenant-scoped.
- Added regression tests and docs for the DeltaDB lock recovery path and the
  Team Onboarding style capability-map tenant-scope path.

## 0.1.0-alpha.24

- Consolidated the public alpha adoption surface: MIT license, package license
  metadata, private GitHub Security Advisory disclosure, stable-alpha status
  matrix, AI-coding loop, three short agent demos, and repeatable agent eval
  task specs.
- `forge new --json` now returns structured JSON for scaffold automation
  instead of human next-step text.
- Added the initial `forge add convex` app-contract recipe with runtime
  placement guardrails, optional Convex environment names, generated docs, and
  a mock testkit. The deeper Convex schema/API importer is documented as
  planned rather than implied.
- Expanded field-report expectations and release/doc tests for license,
  security disclosure, create-app help, Convex recipes, and public docs
  navigation.

## 0.1.0-alpha.23

- Tightened the post-alpha.22 release surface and package evidence:
  added a dedicated Nuxt template smoke workflow, included `nuxt-web` in the
  default field-test template matrix, packaged `docs/cair-protocol.md`, and
  expanded the security/threat-model docs for DeltaDB, agent memory, CAIR,
  Studio bridge, brownfield import, and Nuxt surfaces.
- `forge agent context` now returns explicit `scopeTarget` metadata and prints
  the resolved context target for entry, change, proof, and handoff packs.
- `forge explain` now falls back to the current generated agent contract when
  DeltaDB has no runtime history, marking the entry as contract-defined rather
  than executed.
- DeltaDB work-session inference now treats read-only observation commands such
  as `forge status`, `forge changed`, `forge handoff`, `forge explain`,
  `forge timeline`, and CAIR queries as low-confidence context-gathering
  sessions.

## 0.1.0-alpha.22

- Added focused post-alpha.21 workflow improvements without expanding MCP tools:
  scoped Agent Memory context packs, DeltaDB verbose health details, Semantic
  Timeline stale-proof/causal summaries, Studio snapshot handoff metadata,
  local Delta maintenance commands (`compact`, `prune`, redacted `export`),
  `forge doctor delta`, CAIR timeline events, and a dedicated CAIR Protocol
  documentation page.
- Added an official `nuxt-web` template: a Forge notes backend plus Nuxt app
  using client/server Forge plugins, `web/composables/useNotes.ts`, generated
  Vue composables, a Nitro runtime-config route, and
  `NUXT_PUBLIC_FORGE_URL`.

## 0.1.0-alpha.21

Alpha.21 hardens external-agent privacy and brownfield import polish:

- Codex hook runner queue entries now store redacted payloads instead of raw
  prompts, tool inputs, tool responses, or transcripts.
- Consumed hook queue history is compacted as redacted `.history` entries, so
  old raw queue lines are not copied forward during retention.
- Brownfield import now scopes write/side-effect heuristics to the detected
  route handler when possible, preventing sibling mutating routes from making a
  read-only GET route look command-like.
- Read-shaped `POST /search`, `/query`, `/filter`, `/lookup`, and `/graphql`
  routes are emitted as `command-candidate` with `ambiguous-post-query` risk
  until a human review decides whether they should become Forge queries or
  commands.
- CLI/reference docs now include the CAIR agent protocol and clarify the
  `alpha`/`latest` npm dist-tag policy.

## 0.1.0-alpha.20

Generated-change and hook queue fixes:

- Fixed generated-change diagnostics for `AGENTS.md` generated blocks and
  `.forge/agent/context.json`.
- Skipped probe, invalid, and out-of-workspace queued hook events during Agent
  Memory drain, and bounded large hook queue inspection.
- Preserved empty stdio command arguments, diagnosed malformed command strings,
  and supported structured `service.commandArgs` in external manifests.
- Included the basic example client demo in typecheck coverage.

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

- Derived useful Codex hook metadata from the documented wire format while keeping raw prompts, tool inputs, tool responses, transcripts, and secrets out of Agent Memory.
- Added safe command summaries, tool-call ids, result status, exit codes, response summaries, inferred files, and inferred runtime entries for Codex tool events.
- Updated Codex hook installation with hook timeouts, status messages, and a local wrapper for checkout-based ingestion.
- Updated Agent Memory docs and regression coverage for real Codex hook payloads.

## 0.1.0-alpha.17

External runtime timeline metadata:

- Enriched `forge timeline` and `forge explain` for imported external runtimes.
- External command/query calls now keep `service`, `language`, `risk`, `policy`, `tenantScoped`, and `needsApproval` metadata in DeltaDB.
- Promoted this release on npm as both `alpha` and `latest`.

## 0.1.0-alpha.16

Stability alignment:

- Fixed `forge timeline` and `forge explain` crashes after large generated artifact batches.
- Fixed brownfield import detection for root-level Next.js App Router and Pages API routes.
- Updated CLI, Agent Memory, and DeltaDB docs for the alpha.16 command surface.

## 0.1.0-alpha.15

Brownfield import analysis:

- Added H49 `forge import analyze`, `forge import inspect`, and `forge inspect imported --json`.
- Emits `.forge/import` inventory, route, frontend call, candidate entry, risk, migration plan, and imported agent contract artifacts.
- Keeps every imported entry hidden from agents until review, with approval required for command-like or risky static detections.

## 0.1.0-alpha.14

Java and Nuxt/Vue support:

- Added the Java external runtime adapter, Spring Boot starter, and `java-billing` conformance example.
- Added generated Vue bindings and the `forgeos/vue` export.
- Added Nuxt UI scaffolding through `forge make ui --framework nuxt`.
- Updated docs, agent adapter guidance, generated manifests, and focused Java/Vue/Nuxt tests.

## 0.1.0-alpha.13

Agent Memory Bridge:

- Added H48 redacted external agent event ingestion with normalized `forge.agent-event.v1` envelopes.
- Added Codex and Claude Code hook installers plus Cursor MCP/rules setup.
- Added `forge mcp serve`, `forge agent install`, `forge agent ingest`, `forge agent context`, and `forge agent memory`.
- Persisted external agent activity in DeltaDB and linked agent/tool/file events into the semantic timeline.

## 0.1.0-alpha.12

Semantic Timeline:

- Added the H47 DeltaDB semantic timeline projection with rebuildable events, entity indexes, causal edges, and projection state.
- Upgraded `forge timeline` from raw operations into an entity-oriented timeline for runtime entries, policies, diagnostics, proofs, services, files, and sessions.
- Added proof staleness detection and timeline context in `forge explain`.

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

Compiler, external runtime, and Go adapter:

- Added the Forge external runtime protocol bridge for manifest-backed commands and queries.
- Added the Go adapter MVP with a real `go-billing` conformance example.
- Emitted external service metadata into inspect/API/agent artifacts, including `needsApproval` for agent tools.
- Reuse compiler classifier package signals across export classification, dropping repeated package signal scans.
- Reuse serialized graph JSON when rendering the largest generated TypeScript graph artifacts.
- Keep generated Forge artifacts aligned with the `0.1.0-alpha.9` compiler/runtime version.

## 0.1.0-alpha.8

Publishing:

- Publish prerelease packages through the ForgeOS alpha publisher so npm dist-tags stay aligned.

## 0.1.0-alpha.7

Publishing:

- Keep npm prerelease publishing on the public alpha dist-tag.

## 0.1.0-alpha.6

Release and packaging hardening:

- Added `forge --version` / `forge --version --json`.
- Updated `create-forgeos-app` help to read the wrapper package version instead of a hardcoded string and bumped the wrapper to `0.1.0-alpha.2`.
- Added dependency vulnerability evidence with an explicit waiver file and CI release gate.
- Updated generated web template dependencies to current Vite/plugin-react and Next majors.

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

- Added public [AI](ai.md) page and AST-aware `rename command` codemod docs.
- Full RTD expansion: [Agent Workflow](agent-workflow.md), [Frontend](frontend.md), [Security & Data](security-and-data.md), [Authoring](authoring.md), [Testing & Repair](testing-and-repair.md), [Self-Host](self-host.md), [Templates](templates.md), Material theme, search, and Mermaid diagrams.

## 0.1.0-alpha.2

Windows and generated-app hardening:

- Fixed Node ESM handler loading on Windows by importing generated app modules through `file://` URLs across commands, queries, liveQueries, outbox actions, workflow steps, mocks, and telemetry adapters.
- Fixed `forge dev` SSE streaming on the Node HTTP fallback so liveQuery snapshots are flushed immediately instead of buffering forever.
- Hardened generated app scaffolding and web dev spawning on Windows.
- Updated the B2B support template to route frontend imports through `web/lib/forge.ts` and use safer handler input validation.
- Added focused tests for Node compatibility, template scaffolding, runtime imports, and streaming responses.
- Added `create-forgeos-app@alpha` for `npm create forgeos-app@alpha`.
- Added GitHub Packages mirror workflow for scoped package publishing.

## 0.1.0-alpha.1

Republish alpha with the dependency/API oracle improvements:

- Added dependency API inspection commands for agents: `forge deps api`, `forge deps trace`, and `forge deps runtime-compat`.
- Added dependency API summaries to `agentContract.json`.
- Added package resolution traces, runtime compatibility metadata, and runtime/type mismatch diagnostics to `packageGraph`.
- Reduced package graph warning noise for `package.json` metadata exports, declaration-file subpaths, and pattern exports.

## 0.1.0-alpha.0

Initial alpha packaging baseline for ForgeOS.

This release line validates npm installation, the `forge` CLI binary, template creation, generated contracts, and the agent-native local development loop.

Added Read the Docs-ready public documentation, generator/package version alignment checks, and a broad generated-app field-test harness for release hardening.
