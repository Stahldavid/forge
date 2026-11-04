// @forge-generated generator=0.1.0-alpha.69 input=72e8e3b82e09b1b06df27f181214fb5d03a6134dcdf81d2a831bef61e0cc456f content=cf387d2332afad2dafbf354b7c2e044712cc328f7d397a98ee599d45c3455c7c
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `basic-forge-app`.

## CLI entrypoint

Use the installed `forge` command for app workflows.

## Task scope and validation

Use the existing user request and authorization to complete the requested work. Resolve routine choices within scope; ask only when a missing decision changes the outcome or a new external effect needs authority. Define completion by the requested behavior and relevant checks, and continue through failures caused by the change.

- Read-only investigation or prose-only edits: inspect the relevant files and existing diff. Check Markdown links or formatting when affected; do not onboard, regenerate, start a runtime or run application suites for unchanged runtime behavior.
- Authored runtime, schema, policy or generated-contract changes: inspect the relevant generated context, run `forge generate` and `forge check`, then affected tests or `forge verify --changed`. Preserve tenant/auth, transaction and effect boundaries.
- Frontend/runtime diagnosis: use `forge dev --once --json`, targeted inspection or the requested runtime only when needed. Hooks/onboarding are setup operations, not prerequisites to every edit.
- Release, broad migration or delivery with an explicit comprehensive gate: run `forge verify --strict` and the applicable integration checks. Do not repeat or broaden passing checks without new changes or evidence.

Use `forge status --json`, `forge changed --json`, `forge handoff --json` or `forge agent print-context --json` when their information is needed. Select relevant context rather than running every command. Existing authorized local checks do not require approval at each step; publication, deployment and billable external work retain their own boundaries.

## CAIR first

Before reading large files or hand-writing patches, prefer the generated CAIR guide:

```bash
forge cair snapshot
forge cair query "Q ST"
forge cair query "Q S name=<symbol>"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
```

Use `src/forge/_generated/agentCairGuide.md` for the full compact protocol. Plan CAIR mutations before applying them:

```bash
forge cair action --plan "A RN t=S#1 nn=<newName>"
forge cair action "A APPLY plan=<returned-plan-path>"
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
- Do not read secrets or server runtime config through `process.env` in Forge runtime code; use `ctx.secrets` or generated config context. Public frontend bridge env such as `NEXT_PUBLIC_*` and `NUXT_PUBLIC_*` is allowed in web bridge files.
- Do not access cross-tenant data.
- Commands must use `ctx.emit` for side effects.
- Actions and workflows handle side effects after commit.
- Do not rely on in-memory Pub/Sub as the source of truth for liveQuery invalidation.

## Context by task

Read only the generated context relevant to the question. `src/forge/_generated/appMap.md` describes entrypoints and boundaries; `runtimeRules.md` covers runtime invariants; `operationPlaybooks.md` covers schema, command, query, frontend, dependency and repair workflows. `agentCairGuide.md` contains the structure-aware protocol. Use `agentQuickstart.md` as a command catalog, not an itinerary. These files are recreated by generation when missing.

## Data

Tenant-scoped tables:

- tickets via tenantId

## Policies

- billing.manage: admin, owner
- tickets.create: admin, member, owner
- tickets.read: admin, member, owner

## Secrets

- POSTHOG_HOST (optional)
- POSTHOG_KEY (required)
- STRIPE_SECRET_KEY (required)
- STRIPE_WEBHOOK_SECRET (required)

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
- Runtime endpoints: 5
- Full-stack route bindings: 0

Rules:

- Use the local `web/**/lib/forge.ts` or Nuxt `web/composables/forge.ts` bridge to generated bindings.
- Mount `<ForgeProvider devAuth>` or install the Nuxt Forge plugin in local development.
- Use `useQuery`/`useCommand`/`useLiveQuery` or `useForgeQuery`/`useForgeCommand`/`useForgeLiveQuery` instead of raw Forge endpoint fetches in components.
- Keep frontend routes reflected in `src/forge/_generated/frontendGraph.json`.

## Workflow details

Use `src/forge/_generated/operationPlaybooks.md` for the selected workflow. For a new command, declare auth, preserve transactional/no-network boundaries, generate and run affected checks. For schema/policy changes inspect migration and tenant impact before applying. Debug visible errors with their traceId; preserve it through frontend/runtime boundaries. Use broad verification when the affected risk or explicit delivery gate requires it.

Adapters exported with `forge agent export --target <target>` are derived from the generated contract, maps and rules. Do not treat adapter files as source of truth or install hooks/skills as a side effect of ordinary editing.

<!-- forge-generated:end -->

<!-- user-notes:start -->

Project-specific notes can go here.

<!-- user-notes:end -->
