// @forge-generated generator=0.0.0 input=219ea7f374e4f290890f7b468c21647187b05b8d10e11eb30d0b5207309cc615 content=4f2136319a711c1c6cfd5bb0d2dc610055ea6da11eebc5c1cc923b22adbbbe4b
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `__FORGE_APP_NAME__`.

## Required workflow

Before editing:

```bash
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

## Useful commands

```bash
forge inspect app --json
forge inspect all --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge doctor
forge verify --strict
```

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

## Common tasks

### Add a command

1. Add file in `src/commands`.
2. Declare `auth: can("...")`.
3. Run `forge generate`.
4. Run `forge verify --strict`.

### Add a package

Use:

```bash
forge add <alias>
```

Do not install packages manually unless intentional.

<!-- forge-generated:end -->

<!-- user-notes:start -->

Project-specific notes can go here.

<!-- user-notes:end -->
