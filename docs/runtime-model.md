# Runtime Model

ForgeOS separates deterministic transactional work from side effects.

```text
[Transactional — commands]
  command -> ctx.db write + ctx.emit

[Post-commit — actions / workflows]
  outbox -> action/workflow -> secrets / network / AI

[Read-only — queries / liveQuery]
  query / liveQuery -> ctx.db read only
```

See also:

- [AI](ai.md) — generation, agents, tools, and placement rules
- [Payments](payments.md) — command → emit → action pattern for network integrations

## Commands

Commands are transactional writes.

Allowed:

- `ctx.db` writes.
- `ctx.emit` for side effects after commit.
- Buffered telemetry.

Forbidden:

- Network calls.
- Direct secret access.
- `ctx.ai` and `ctx.agent`.
- Direct filesystem access.
- `process.env`.

## Queries and LiveQueries

Queries and liveQueries are read-only. They should be tenant-scoped when reading tenant data.

LiveQueries use durable invalidations in production. Polling or notification channels are wakeups, not the source of truth.

Queries and liveQueries must not call `ctx.ai`, access secrets, or perform network I/O.

## Actions and Workflows

Actions run side effects after commit. Workflows orchestrate durable steps and retry according to the workflow runtime.

Use actions or workflows for:

- Integrations and network access (Stripe, webhooks, email)
- Secret-backed work via `ctx.secrets`
- AI generation (`ctx.ai.generateText`, `streamText`, `generateStructured`)
- Multi-step agents (`ctx.agent.run` or `ctx.ai.runAgent`)

## AI Placement

Forge exposes two related APIs:

| API | Use when |
|-----|----------|
| `ctx.ai.*` | Single-shot generation or structured output; lower-level agent loop via `ctx.ai.runAgent` |
| `ctx.agent.run` | Declarative agent runs with tools, step limits, and telemetry |

Both are allowed only in **actions, workflows, endpoints, and server** code — never in commands, queries, liveQueries, client, or shared modules.

Typical pattern:

```txt
command   -> fast write + ctx.emit("event")
workflow  -> load data from ctx.db
          -> ctx.ai.generateText(...) or ctx.agent.run(...)
          -> persist result / telemetry
```

The model never reads the database directly. Your handler loads data and passes it in the prompt or exposes it through Forge tools with policy and tenant checks.

## Auth and Tenant Isolation

Production auth uses JWT or OIDC. Local development can use `dev-headers` mode.

Tenant isolation is expressed in Forge policies and tenant scope metadata. Postgres deployments can compile tenant rules to database-enforced RLS.

Agent tools and auto-tools inherit the same auth and tenant context as runtime commands and queries.
