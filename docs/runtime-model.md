# Runtime Model

ForgeOS separates deterministic transactional work from side effects.

## Commands

Commands are transactional writes.

Allowed:

- `ctx.db` writes.
- `ctx.emit` for side effects after commit.
- Buffered telemetry.

Forbidden:

- Network calls.
- Direct secret access.
- `ctx.ai`.
- Direct filesystem access.
- `process.env`.

## Queries and LiveQueries

Queries and liveQueries are read-only. They should be tenant-scoped when reading tenant data.

LiveQueries use durable invalidations in production. Polling or notification channels are wakeups, not the source of truth.

## Actions and Workflows

Actions run side effects after commit. Workflows orchestrate durable steps and retry according to the workflow runtime.

Use actions or workflows for integrations, AI calls, network access, and secret-backed work.

## Auth and Tenant Isolation

Production auth uses JWT or OIDC. Local development can use `dev-headers` mode.

Tenant isolation is expressed in Forge policies and tenant scope metadata. Postgres deployments can compile tenant rules to database-enforced RLS.
