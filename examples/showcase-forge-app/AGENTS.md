// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=cb987df495c2e7dec5124b3b58e53de1aa35e1ff1d94e3386d569829bf7a533d
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `showcase-forge-app`.

## Task scope and validation

Use the existing user request and authorization to complete the requested work. Resolve routine choices within scope; ask only when a missing decision changes the outcome or a new external effect needs authority. Define completion by the requested behavior and relevant checks, and continue through failures caused by the change.

- Read-only investigation or prose-only edits: inspect the relevant files and existing diff. Check Markdown links or formatting when affected; do not onboard, regenerate, start a runtime or run application suites for unchanged runtime behavior.
- Authored runtime, schema, policy or generated-contract changes: inspect the relevant generated context, run `forge generate` and `forge check`, then affected tests or `forge verify --changed`. Preserve tenant/auth, transaction and effect boundaries.
- Frontend/runtime diagnosis: use `forge dev --once --json`, targeted inspection or the requested runtime only when needed. Hooks/onboarding are setup operations, not prerequisites to every edit.
- Release, broad migration or delivery with an explicit comprehensive gate: run `forge verify --strict` and the applicable integration checks. Do not repeat or broaden passing checks without new changes or evidence.

Use `forge status --json`, `forge changed --json`, `forge handoff --json` or `forge agent print-context --json` when their information is needed. Select relevant context rather than running every command. Existing authorized local checks do not require approval at each step; publication, deployment and billable external work retain their own boundaries.

## Do not edit

Do not:

- `src/forge/_generated/**`
- `forge.lock`
- `deploy/docker-compose.yml`, unless changing deployment config intentionally

## Runtime model

- Commands are transactional writes.
- Queries and liveQueries are read-only.
- Actions perform side effects after commit.
- Workflows orchestrate durable steps.
- AI is only allowed in actions, workflows, endpoints, and server code.
- Secrets are accessed through `ctx.secrets`.

## Runtime rules

- Do not import network packages inside `command`, `query`, or `liveQuery`.
- Do not use `process.env` directly.
- Do not access cross-tenant data.
- Commands must use `ctx.emit` for side effects.
- Actions and workflows handle side effects after commit.

## Context by task

Read only the generated context relevant to the question. `src/forge/_generated/appMap.md` describes entrypoints and boundaries; `runtimeRules.md` covers runtime invariants; `operationPlaybooks.md` covers schema, command, query, frontend, dependency and repair workflows. `agentCairGuide.md` contains the structure-aware protocol. Use `agentQuickstart.md` as a command catalog, not an itinerary. These files are recreated by generation when missing.

## Data

Tenant-scoped tables:

- tickets via tenant_id
- users via tenant_id

## Policies

- billing.manage: owner
- tickets.close: admin, owner
- tickets.create: admin, member, owner
- tickets.read: admin, member, owner
- tickets.update: admin, owner

## Secrets

- none

## Workflow details

Use `src/forge/_generated/operationPlaybooks.md` for the selected workflow. For a new command, declare auth, preserve transactional/no-network boundaries, generate and run affected checks. For schema/policy changes inspect migration and tenant impact before applying. Debug visible errors with their traceId; preserve it through frontend/runtime boundaries. Use broad verification when the affected risk or explicit delivery gate requires it.

Adapters exported with `forge agent export --target <target>` are derived from the generated contract, maps and rules. Do not treat adapter files as source of truth or install hooks/skills as a side effect of ordinary editing.

<!-- forge-generated:end -->

<!-- user-notes:start -->

Project-specific notes can go here.

<!-- user-notes:end -->
