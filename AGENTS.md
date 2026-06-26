// @forge-generated generator=0.1.0-alpha.30 input=126f7f78b3bd4495b73c6a82f3fc9d5661b8040ee4a43d68eef6b59fc7e33d57 content=0d493cf0e41b71cb652d5e0e1b0c1f83d2a1281b748321f0b00f0773ba93074e
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `forgeos`.

## CLI entrypoint

This is the ForgeOS framework checkout. Use `node bin/forge.mjs ...` so maintainer commands run against this source tree; reserve the global `forge` command for installed-package smoke tests.

## Required workflow

Before editing:

```bash
node bin/forge.mjs agent onboard --target codex --json
node bin/forge.mjs status --json
node bin/forge.mjs changed --json
node bin/forge.mjs handoff --json
node bin/forge.mjs do inspect --json
node bin/forge.mjs dev --once --json
node bin/forge.mjs agent print-context --json
node bin/forge.mjs check --json
```

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

After editing:

```bash
node bin/forge.mjs generate
node bin/forge.mjs check
node bin/forge.mjs verify framework
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

## Useful commands

```bash
node bin/forge.mjs do "<objective>" --json
node bin/forge.mjs do fix --json
node bin/forge.mjs do verify --json
node bin/forge.mjs dev --once --json
node bin/forge.mjs dev
node bin/forge.mjs handoff --json
node bin/forge.mjs inspect app --json
node bin/forge.mjs inspect all --json
node bin/forge.mjs inspect all --full --json
node bin/forge.mjs inspect frontend --json
node bin/forge.mjs inspect capabilities --json
node bin/forge.mjs inspect agent-tools --json
node bin/forge.mjs deps inspect <package> --json
node bin/forge.mjs deps api <package> <symbol> --json
node bin/forge.mjs deps trace <package> --json
node bin/forge.mjs auth check --json
node bin/forge.mjs inspect runtime-matrix --json
node bin/forge.mjs inspect policies --json
node bin/forge.mjs inspect client --json
node bin/forge.mjs inspect live-production --json
node bin/forge.mjs live status --json
node bin/forge.mjs doctor
node bin/forge.mjs doctor windows --json
node bin/forge.mjs setup windows --json
node bin/forge.mjs agent print-context --json
node bin/forge.mjs agent doctor --target codex --json
node bin/forge.mjs ai tools --json
node bin/forge.mjs ai agents --json
node bin/forge.mjs ai trace <traceId> --json
node bin/forge.mjs verify --smoke
node bin/forge.mjs verify --standard
node bin/forge.mjs verify framework
```

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

## Common tasks

### Choose the right workflow

Use:

```bash
node bin/forge.mjs do "<objective>" --json
node bin/forge.mjs do fix --json
node bin/forge.mjs do connect-ui --json
node bin/forge.mjs do verify --json
```

`node bin/forge.mjs do` returns intent, plan, filesToInspect, filesToChange, risks, concrete commands, and nextAction. Prefer it before choosing lower-level CLI commands manually.

### Add a command

1. Add file in `src/commands`.
2. Declare `auth: can("...")`.
3. Run `node bin/forge.mjs generate`.
4. Run `node bin/forge.mjs verify framework`.

### Scaffold a resource

Use:

```bash
node bin/forge.mjs make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json
node bin/forge.mjs make resource <name> --fields title:text,status:enum(open,closed) --with-ui --yes
node bin/forge.mjs make ui --framework vite --dry-run --json
node bin/forge.mjs make ui --framework nuxt --dry-run --json
node bin/forge.mjs make ai-chat support --dry-run --json
```

Review the plan before applying when the resource touches schema or policies.

### Check frontend wiring

Use:

```bash
node bin/forge.mjs dev --once --json
node bin/forge.mjs dev
node bin/forge.mjs inspect frontend --json
node bin/forge.mjs inspect capabilities --json
```

`node bin/forge.mjs dev` starts the API runtime and web app together when `web/` exists. `node bin/forge.mjs dev --once --json` reports routes, components, providers/plugins, bridge files, generated client bindings, direct runtime fetch warnings, capability-map parity warnings, and fix hints.

### Apply a feature blueprint

Use:

```bash
node bin/forge.mjs feature validate .forge/blueprints/<name>.json --json
node bin/forge.mjs feature plan .forge/blueprints/<name>.json
node bin/forge.mjs feature apply .forge/blueprints/<name>.json --yes
```

Review high-risk plans before applying. Use `--allow-high-risk` only when intentional.

### Safely refactor a feature

Use:

```bash
node bin/forge.mjs refactor rename field tickets.priority tickets.urgency --dry-run --json
node bin/forge.mjs refactor rename field tickets.priority tickets.urgency --yes
node bin/forge.mjs refactor rename command createTicket openTicket --dry-run --json
node bin/forge.mjs refactor rename command createTicket openTicket --yes
```

These codemods are AST-aware for `extract-action`, `rename command`, `rename field`, and `rename table`. Command renames update runtime registries, generated client references, frontend hooks, tests, and string references where safe. Field renames are scoped to the target table, so `tickets.priority` only rewrites references linked to `tickets`.

Never edit `src/forge/_generated/**` directly. Review migration hints before applying command, field, or table renames.

### Plan impact-based tests

Use:

```bash
node bin/forge.mjs impact --changed --json
node bin/forge.mjs test plan --changed --json
node bin/forge.mjs test run --changed --timeout-ms 120000 --json
node bin/forge.mjs verify --standard
```

Use `node bin/forge.mjs verify --standard` for the normal agent development loop. Finish handoffs with `node bin/forge.mjs verify framework` when the change is ready.

### Repair a failing check

When a Forge check fails, do not guess. Use:

```bash
node bin/forge.mjs repair diagnose --from-last-test-run --json
node bin/forge.mjs repair plan --from-last-test-run --write
```

Apply only high-confidence deterministic repairs automatically. Review medium or low confidence repairs before changing code.

### Add AI tools or agents

Use:

```bash
node bin/forge.mjs generate
node bin/forge.mjs inspect ai --json
node bin/forge.mjs agent print-context --json
node bin/forge.mjs ai check --json
node bin/forge.mjs ai trace <traceId> --json
```

Define tools with `aiTool({ inputSchema, outputSchema, risk, needsApproval, handler })` and agents with `agent({ provider, model, instructions, tools, stopWhen })`. Execute agents with `ctx.agent.run` or `ctx.ai.runAgent` only from actions, workflows, endpoints, or server code. In dev, POST `/ai/agents/run` returns JSON for automation and POST `/ai/agents/chat` returns an AI SDK UIMessage stream for React `useChat`; both accept `agent: "<exportedAgentName>"` and use generated auto-tools from `agentTools.json`.

### Export agent adapters

Use:

```bash
node bin/forge.mjs agent export --target generic
node bin/forge.mjs agent export --target codex
node bin/forge.mjs agent export --target cursor
node bin/forge.mjs agent export --target claude
```

Adapter files are derived from `agentContract.json`, `appMap.md`, `runtimeRules.md`, `operationPlaybooks.md`, and this `AGENTS.md`. Do not treat Codex, Cursor, Claude, or custom adapter files as the source of truth.

### Add a package

Use:

```bash
node bin/forge.mjs add <alias>
```

Do not install packages manually unless intentional.

### Upgrade a package

Use:

```bash
node bin/forge.mjs deps upgrade-plan <package> --to latest
node bin/forge.mjs deps inspect <package> --json
node bin/forge.mjs deps api <package> <symbol> --json
node bin/forge.mjs deps upgrade-apply <plan>
node bin/forge.mjs verify framework
```

Do not manually edit `package.json` for package upgrades unless necessary.

### Debug liveQuery

Use:

```bash
node bin/forge.mjs live status --json
node bin/forge.mjs live invalidations list --json
node bin/forge.mjs live debug <subscriptionId> --json
```

Durable invalidations live in `_forge_live_invalidations`.

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

- `bun run forge generate` rewrites `src/forge/_generated/**`, `forge.lock`, and the `// @forge-generated` header `input=` hash in `AGENTS.md`. These regenerated diffs are environment-dependent and should NOT be committed (per "Do not edit" above). `forge verify` regenerates internally, so `generate-check` can pass even while `git status` shows these as dirty. Run `git checkout -- .` to discard them before committing unrelated work.
- The CLI runs under Node via `tsx` (`node ./bin/forge.mjs ...` or `npm run forge -- ...`); only the test runner needs Bun.
- To run an actual Forge app end-to-end, scaffold one from a template and run the dev servers. From a temp dir: `node /workspace/bin/forge.mjs new notes-app --template minimal-web --package-manager npm --forge-spec "file:/workspace" --install --no-git`, then `cd notes-app && npm run dev`. `forge dev` starts the API runtime (pglite, default `http://127.0.0.1:3765`) and the Vite web app (default `http://127.0.0.1:5173`); use `forge dev --api-only` for backend only.
- Hitting the runtime directly: POST `/commands/<name>` and `/queries/<name>` with body shaped as `{ "args": { ... } }`. In `dev-headers` auth mode pass `x-forge-user-id` and `x-forge-role` (e.g. `owner`) headers; `<ForgeProvider devAuth>` defaults to user `dev-user`, tenant `dev-tenant`, role `owner`.

<!-- user-notes:end -->
