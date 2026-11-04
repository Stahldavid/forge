// @forge-generated generator=0.1.0-alpha.72 input=a9884755157b13634a2b69e255d6418f0092af011d647161d0cfff332ffbbe63 content=6a79256a9f99f221866a893d3834747d21c5ac1f675db83b8c9f4dab50220155
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `forgeos`.

## CLI entrypoint

This is the ForgeOS framework checkout. Use `node bin/forge.mjs ...` so maintainer commands run against this source tree; reserve the global `forge` command for installed-package smoke tests.

## Task scope and validation

Use the existing user request and authorization to complete the requested work. Resolve routine choices within scope; ask only when a missing decision changes the outcome or a new external effect needs authority. Define completion by the requested behavior and relevant checks, and continue through failures caused by the change.

- Read-only investigation or prose-only edits: inspect the relevant files and existing diff. Check Markdown links or formatting when affected; do not onboard, regenerate, start a runtime or run application suites for unchanged runtime behavior.
- Authored runtime, schema, policy or generated-contract changes: inspect the relevant generated context, run `node bin/forge.mjs generate` and `node bin/forge.mjs check`, then affected tests or `node bin/forge.mjs verify --changed`. Preserve tenant/auth, transaction and effect boundaries.
- Frontend/runtime diagnosis: use `node bin/forge.mjs dev --once --json`, targeted inspection or the requested runtime only when needed. Hooks/onboarding are setup operations, not prerequisites to every edit.
- Release, broad migration or delivery with an explicit comprehensive gate: run `node bin/forge.mjs verify framework` and the applicable integration checks. Do not repeat or broaden passing checks without new changes or evidence.

Use `node bin/forge.mjs status --json`, `node bin/forge.mjs changed --json`, `node bin/forge.mjs handoff --json` or `node bin/forge.mjs agent print-context --json` when their information is needed. Select relevant context rather than running every command. Existing authorized local checks do not require approval at each step; publication, deployment and billable external work retain their own boundaries.

## CAIR first

Before reading large files or hand-writing patches, prefer the generated CAIR guide:

```bash
node bin/forge.mjs cair snapshot
node bin/forge.mjs cair query "Q ST"
node bin/forge.mjs cair query "Q S name=<symbol>"
node bin/forge.mjs cair query "Q D S#1"
node bin/forge.mjs cair query "Q R S#1"
node bin/forge.mjs cair query "Q I S#1"
```

Use `src/forge/_generated/agentCairGuide.md` for the full compact protocol. Plan CAIR mutations before applying them:

```bash
node bin/forge.mjs cair action --plan "A RN t=S#1 nn=<newName>"
node bin/forge.mjs cair action "A APPLY plan=<returned-plan-path>"
```

## Do not edit

Do not:

- `src/forge/_generated/**`
- `forge.lock`
- `deploy/docker-compose.yml`, unless changing deployment config intentionally

Template apps may ignore `src/forge/_generated/**` and `forge.lock` in git to reduce visual noise. Recreate them with `node bin/forge.mjs generate` before checking, testing, or handing work off.

## Runtime model

- Commands are transactional writes.
- Queries and liveQueries are read-only.
- Actions perform side effects after commit.
- Workflows orchestrate durable steps.
- Production liveQuery uses a durable invalidation log; polling/notify are wakeups only.
- Production API calls use `Authorization: Bearer <JWT>` in `jwt` or `oidc` auth mode.
- `dev-headers` auth is for `node bin/forge.mjs dev`, tests, and local agent workflows only.
- AI is only allowed in actions, workflows, endpoints, and server code.
- Secrets are accessed through `ctx.secrets`.

## Runtime rules

- Do not import network packages inside `command`, `query`, or `liveQuery`.
- Do not read secrets or server runtime config through `process.env` in Forge runtime code; use `ctx.secrets` or generated config context. Public frontend bridge env such as `NEXT_PUBLIC_*` and `NUXT_PUBLIC_*` is allowed in web bridge files.
- Do not access cross-tenant data.
- Commands must use `ctx.emit` for side effects.
- Actions and workflows handle side effects after commit.
- Do not rely on in-memory Pub/Sub as the source of truth for liveQuery invalidation.

## Context by task

Read only the generated context relevant to the question. `src/forge/_generated/appMap.md` describes entrypoints and boundaries; `runtimeRules.md` covers runtime invariants; `operationPlaybooks.md` covers schema, command, query, frontend, dependency and repair workflows. `agentCairGuide.md` contains the structure-aware protocol. Use `agentQuickstart.md` as a command catalog, not an itinerary. These files are recreated by generation when missing.

## Data

Tenant-scoped tables:

- none

## Policies

- none

## Secrets

- AI_GATEWAY_API_KEY (required)
- ANTHROPIC_API_KEY (required)
- OPENAI_API_KEY (required)

## AI Tools And Agents

- AI SDK engine: Vercel AI SDK v6.
- Forge layer: generated registry, runtime rules, telemetry, secrets, tenant/auth context, and agent contract.
- Use `ctx.agent.run` or `ctx.ai.runAgent` only in actions, workflows, endpoints, and server code.
- Do not create custom tool loops; use Forge tools and AI SDK `ToolLoopAgent` through the Forge runtime.

Tools:

- none

Agents:

- none

## Auth

- Modes: dev-headers, jwt, oidc, disabled
- Production auth: `jwt` or `oidc`
- Bearer header: `Authorization: Bearer <token>`
- Tenant claim: `tenant_id`

## Frontend

- Present: no
- Framework: none
- Web URL: none
- Routes: 0
- Components: 0
- Client bindings: 0
- Runtime endpoints: 0
- Full-stack route bindings: 0

Rules:

- Use the local `web/**/lib/forge.ts` or Nuxt `web/composables/forge.ts` bridge to generated bindings.
- Mount `<ForgeProvider devAuth>` or install the Nuxt Forge plugin in local development.
- Use `useQuery`/`useCommand`/`useLiveQuery` or `useForgeQuery`/`useForgeCommand`/`useForgeLiveQuery` instead of raw Forge endpoint fetches in components.
- Keep frontend routes reflected in `src/forge/_generated/frontendGraph.json`.

## Workflow details

Use `src/forge/_generated/operationPlaybooks.md` for the selected workflow. For a new command, declare auth, preserve transactional/no-network boundaries, generate and run affected checks. For schema/policy changes inspect migration and tenant impact before applying. Debug visible errors with their traceId; preserve it through frontend/runtime boundaries. Use broad verification when the affected risk or explicit delivery gate requires it.

Adapters exported with `node bin/forge.mjs agent export --target <target>` are derived from the generated contract, maps and rules. Do not treat adapter files as source of truth or install hooks/skills as a side effect of ordinary editing.

<!-- forge-generated:end -->

<!-- user-notes:start -->

Project-specific notes can go here.

## Cursor Cloud specific instructions

This repo is the ForgeOS framework/compiler itself (package `forgeos`), not a generated app. The development toolchain is Node.js (>= 22.14, present) plus **Bun**, which is the repo's test runner and canonical package manager (`bun.lock`). The Cloud VM snapshot has Bun pre-installed at `~/.bun/bin/bun` (added to `PATH` via `~/.bashrc`); if `bun` is not on `PATH` in a non-login shell, use `~/.bun/bin/bun` or `export PATH="$HOME/.bun/bin:$PATH"`.

Standard commands (see `package.json`, `CONTRIBUTING.md`, `.github/workflows/ci.yml`):

- Install deps: `bun install --ignore-scripts` (the update script runs this). `--ignore-scripts` matches CI; native deps like `tree-sitter` are not built and tests do not need them.
- Lint: `npm run lint` (runs `node --import tsx ./src/forge/cli/lint-forge.ts`).
- Typecheck: `npm run typecheck` (`tsc --noEmit`).
- Tests: `bun test` (~2 min, 650 tests). 4 tests are skipped by design unless extra tooling/env is set (`FORGE_SMOKE_REAL=1`, a real Postgres, `FORGE_MAVEN`).
- Generate + verify: `bun run forge generate` then `bun run forge verify --standard --script-timeout-ms 120000`.

Non-obvious gotchas:

- `bun run forge generate` rewrites `src/forge/_generated/**`, `forge.lock`, and the `// @forge-generated` header `input=` hash in `AGENTS.md`. These regenerated diffs are environment-dependent and should NOT be committed (per "Do not edit" above). `forge verify` regenerates internally, so `generate-check` can pass even while `git status` shows these as dirty. Preserve all pre-existing edits. Review generated-only paths against the task baseline and restore only explicitly selected, unchanged-since-generation artifacts when appropriate; never discard the whole working tree.
- The CLI runs under Node via `tsx` (`node ./bin/forge.mjs ...` or `npm run forge -- ...`); only the test runner needs Bun.
- To run an actual Forge app end-to-end, scaffold one from a template and run the dev servers. From a temp dir: `node /workspace/bin/forge.mjs new notes-app --template minimal-web --package-manager npm --forge-spec "file:/workspace" --install --no-git`, then `cd notes-app && npm run dev`. `forge dev` starts the API runtime (pglite, default `http://127.0.0.1:3765`) and the Vite web app (default `http://127.0.0.1:5173`); use `forge dev --api-only` for backend only.
- Hitting the runtime directly: POST `/commands/<name>` and `/queries/<name>` with body shaped as `{ "args": { ... } }`. In `dev-headers` auth mode pass `x-forge-user-id` and `x-forge-role` (e.g. `owner`) headers; `<ForgeProvider devAuth>` defaults to user `dev-user`, tenant `dev-tenant`, role `owner`.

<!-- user-notes:end -->
