// @forge-generated generator=0.1.0-alpha.15 input=67cf6717e9ba5e94f88e7a31f4ec4bd11bca063e91c093d1365c00db340f2c1e content=143ee5e2d6fee031a4952f21ee3cc8f1e5678fd11ea673c2cb79196c251c32b6
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `forgeos`.

## Required workflow

Before editing:

```bash
forge do inspect --json
forge dev --once --json
forge inspect all --json
forge check --json
```

After editing:

```bash
forge generate
forge check
forge verify --strict
```

## Do not edit

Do not:

- `src/forge/_generated/**`
- `forge.lock`
- `deploy/docker-compose.yml`, unless changing deployment config intentionally

Template apps may ignore `src/forge/_generated/**` and `forge.lock` in git to reduce visual noise. Recreate them with `forge generate` before checking, testing, or handing work off.

## Runtime model

- Commands are transactional writes.
- Queries and liveQueries are read-only.
- Actions perform side effects after commit.
- Workflows orchestrate durable steps.
- Production liveQuery uses a durable invalidation log; polling/notify are wakeups only.
- Production API calls use `Authorization: Bearer <JWT>` in `jwt` or `oidc` auth mode.
- `dev-headers` auth is for `forge dev`, tests, and local agent workflows only.
- AI is only allowed in actions, workflows, endpoints, and server code.
- Secrets are accessed through `ctx.secrets`.

## Runtime rules

- Do not import network packages inside `command`, `query`, or `liveQuery`.
- Do not use `process.env` directly.
- Do not access cross-tenant data.
- Commands must use `ctx.emit` for side effects.
- Actions and workflows handle side effects after commit.
- Do not rely on in-memory Pub/Sub as the source of truth for liveQuery invalidation.

## Useful commands

```bash
forge do "<objective>" --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge inspect app --json
forge inspect all --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge deps inspect <package> --json
forge deps api <package> <symbol> --json
forge deps trace <package> --json
forge auth check --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge inspect live-production --json
forge live status --json
forge doctor
forge doctor windows --json
forge setup windows --json
forge agent print-context --json
forge ai tools --json
forge ai agents --json
forge ai trace <traceId> --json
forge verify --smoke
forge verify --standard
forge verify --strict
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
forge do "<objective>" --json
forge do fix --json
forge do connect-ui --json
forge do verify --json
```

`forge do` returns intent, plan, filesToInspect, filesToChange, risks, concrete commands, and nextAction. Prefer it before choosing lower-level CLI commands manually.

### Add a command

1. Add file in `src/commands`.
2. Declare `auth: can("...")`.
3. Run `forge generate`.
4. Run `forge verify --strict`.

### Scaffold a resource

Use:

```bash
forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json
forge make resource <name> --fields title:text,status:enum(open,closed) --with-ui --yes
forge make ui --framework vite --dry-run --json
forge make ui --framework nuxt --dry-run --json
forge make ai-chat support --dry-run --json
```

Review the plan before applying when the resource touches schema or policies.

### Check frontend wiring

Use:

```bash
forge dev --once --json
forge dev
forge inspect frontend --json
forge inspect capabilities --json
```

`forge dev` starts the API runtime and web app together when `web/` exists. `forge dev --once --json` reports routes, components, providers/plugins, bridge files, generated client bindings, direct runtime fetch warnings, capability-map parity warnings, and fix hints.

### Apply a feature blueprint

Use:

```bash
forge feature validate .forge/blueprints/<name>.json --json
forge feature plan .forge/blueprints/<name>.json
forge feature apply .forge/blueprints/<name>.json --yes
```

Review high-risk plans before applying. Use `--allow-high-risk` only when intentional.

### Safely refactor a feature

Use:

```bash
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --yes
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename command createTicket openTicket --yes
```

These codemods are AST-aware for `extract-action`, `rename command`, `rename field`, and `rename table`. Command renames update runtime registries, generated client references, frontend hooks, tests, and string references where safe. Field renames are scoped to the target table, so `tickets.priority` only rewrites references linked to `tickets`.

Never edit `src/forge/_generated/**` directly. Review migration hints before applying command, field, or table renames.

### Plan impact-based tests

Use:

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge verify --standard
```

Use `forge verify --standard` for the normal agent development loop. Finish handoffs with `forge verify --strict` when the change is ready.

### Repair a failing check

When a Forge check fails, do not guess. Use:

```bash
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

Apply only high-confidence deterministic repairs automatically. Review medium or low confidence repairs before changing code.

### Add AI tools or agents

Use:

```bash
forge generate
forge inspect all --json
forge ai check --json
forge ai trace <traceId> --json
```

Define tools with `aiTool({ inputSchema, outputSchema, risk, needsApproval, handler })` and agents with `agent({ provider, model, instructions, tools, stopWhen })`. Execute agents with `ctx.agent.run` or `ctx.ai.runAgent` only from actions, workflows, endpoints, or server code. In dev, POST `/ai/agents/run` returns JSON for automation and POST `/ai/agents/chat` returns an AI SDK UIMessage stream for React `useChat`; both accept `agent: "<exportedAgentName>"` and use generated auto-tools from `agentTools.json`.

### Export agent adapters

Use:

```bash
forge agent export --target generic
forge agent export --target codex
forge agent export --target cursor
forge agent export --target claude
```

Adapter files are derived from `agentContract.json`, `appMap.md`, `runtimeRules.md`, `operationPlaybooks.md`, and this `AGENTS.md`. Do not treat Codex, Cursor, Claude, or custom adapter files as the source of truth.

### Add a package

Use:

```bash
forge add <alias>
```

Do not install packages manually unless intentional.

### Upgrade a package

Use:

```bash
forge deps upgrade-plan <package> --to latest
forge deps inspect <package> --json
forge deps api <package> <symbol> --json
forge deps upgrade-apply <plan>
forge verify --strict
```

Do not manually edit `package.json` for package upgrades unless necessary.

### Debug liveQuery

Use:

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

Durable invalidations live in `_forge_live_invalidations`.

<!-- forge-generated:end -->

<!-- user-notes:start -->

Project-specific notes can go here.

<!-- user-notes:end -->
