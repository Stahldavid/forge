// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=7cc9552d49f1791ca0dfca54901bf40f57e5d629a7e549b71a6bfc860f477850
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `basic-forge-app`.

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

## Policies

- billing.manage: admin, owner
- tickets.create: admin, member, owner
- tickets.read: admin, member, owner

## Secrets

- POSTHOG_HOST (optional)
- POSTHOG_KEY (required)
- STRIPE_SECRET_KEY (required)
- STRIPE_WEBHOOK_SECRET (required)

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
