// @forge-generated generator=0.0.0 input=73411733ee4b2adeaa331f0cdfd5f207efa0f149c37c2770aee30c1b71a96c1b content=d790ac4911fd50f6745e85abd4efb4f5d3f4e253cd0e906cbb52d8adc7b5240f
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
forge inspect app --json
forge inspect all --json
forge auth check --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge inspect live-production --json
forge live status --json
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

## Auth

- Modes: dev-headers, jwt, oidc, disabled
- Production auth: `jwt` or `oidc`
- Bearer header: `Authorization: Bearer <token>`
- Tenant claim: `tenant_id`

## Common tasks

### Add a command

1. Add file in `src/commands`.
2. Declare `auth: can("...")`.
3. Run `forge generate`.
4. Run `forge verify --strict`.

### Scaffold a resource

Use:

```bash
forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json
forge make resource <name> --fields title:text,status:enum(open,closed) --yes
```

Review the plan before applying when the resource touches schema or policies.

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
```

Never edit `src/forge/_generated/**` directly. Review migration hints before applying field or table renames.

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
