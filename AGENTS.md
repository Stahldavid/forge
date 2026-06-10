// @forge-generated generator=0.0.0 input=f920ff0aa4c0125a423c57656801547afa5c89b30c164045aae1359c81f59f56 content=ceb9cc77c6986e2d6e3e42ced952ccd0c11f44bbdcde613a662ff56a044f3738
# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named `forge`.

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

- none

## Policies

- none

## Secrets

- AI_GATEWAY_API_KEY (required)
- ANTHROPIC_API_KEY (required)
- OPENAI_API_KEY (required)

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
