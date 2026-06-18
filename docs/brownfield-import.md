# Brownfield Import

`forge import analyze` turns an existing TypeScript or JavaScript app into a reviewed migration map.

It performs a static scan only. It does not edit source code, execute handlers, create runtime entries, or expose imported operations to agents.

## Analyze An Existing App

```bash
forge import analyze --json
forge import inspect --json
forge inspect imported --json
```

The analyzer writes:

```text
.forge/import/inventory.json
.forge/import/routes.json
.forge/import/frontendCalls.json
.forge/import/candidateEntries.json
.forge/import/riskReport.json
.forge/import/migrationPlan.md
.forge/import/importedAgentContract.json
```

## What It Detects

| Surface | Examples |
|---------|----------|
| Frameworks | `next`, `react`, `vue`, `nuxt`, `express`, `nest` |
| Routes | Next.js App Router, Next.js Pages API, Express-style routes, Nest controllers |
| Frontend calls | `fetch("/api/...")`, `axios.post("/api/...")` |
| Environment | `process.env.NAME`, `.env.example`, `.env.sample` |
| Data packages | Prisma, Drizzle, TypeORM, Mongoose, Sequelize, Knex |
| External packages | Stripe, Resend, SendGrid, Twilio, OpenAI, Anthropic, AWS S3 |

## Safety Defaults

Every imported candidate starts with:

```json
{
  "origin": "imported",
  "assurance": "static-scan",
  "reviewStatus": "needs-review",
  "visibleToAgent": false
}
```

Command-like, destructive, external, or unknown entries also keep:

```json
{
  "needsApproval": true
}
```

These defaults prevent a static guess from becoming an executable agent tool.

## Import Analysis Versus Adapters

Use brownfield import when you need a map. Use an adapter when you need execution.

| Need | Use |
|------|-----|
| Discover routes, calls, env usage, and risks in an existing app | `forge import analyze` |
| Plan a staged migration without changing source code | `forge import analyze` |
| Expose a Go, Java, or other service as Forge commands and queries | Forge Protocol adapter |
| Run imported operations through `forge run` or `forge query` | Adapter or native Forge migration |

The usual flow is:

1. Run `forge import analyze`.
2. Review `riskReport.json` and `migrationPlan.md`.
3. Convert safe reads to Forge queries.
4. Convert writes and side effects to commands, actions, or workflows.
5. Use an adapter when the service should stay external but become executable through Forge.

See [Forge Protocol](forge-protocol.md) for executable external runtime adapters.
