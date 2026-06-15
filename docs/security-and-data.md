# Security and Data

ForgeOS expresses **auth**, **policies**, **secrets**, **tenant scope**, and **database rules** as generated contracts — not ad-hoc checks scattered through handlers.

## Auth modes

Configure via generated `authConfig.json` and environment variables:

| Mode | Use | Production |
|------|-----|------------|
| `dev-headers` | Local dev (`x-forge-user-id`, `x-forge-tenant-id`, `x-forge-role`) | No |
| `jwt` | Bearer JWT with configured issuer/audience | Yes |
| `oidc` | OIDC discovery + JWKS via `jose` | Yes |
| `disabled` | Testing only | No |

Environment variables (names vary by app):

```txt
FORGE_AUTH_MODE=jwt
FORGE_AUTH_ISSUER=
FORGE_AUTH_AUDIENCE=
FORGE_AUTH_JWKS_URI=
FORGE_AUTH_ALGORITHMS=
```

JWT/OIDC claims map to Forge auth context:

| Claim | Typical JWT field |
|-------|-------------------|
| User ID | `sub` |
| Tenant ID | `tenant_id` |
| Role | `role` / `roles` |

Check auth configuration:

```bash
forge auth check --json
forge inspect auth --json
```

Production deployments must not rely on `dev-headers`. Forge emits guardrails when dev auth is enabled in production-like modes.

## Policies (RBAC)

Policies are declared in `src/policies.ts` and referenced from runtime entries:

```typescript
import { can, command } from "forge/server";

export const createTicket = command({
  auth: can("tickets.create"),
  handler: async (ctx, args) => { /* ... */ },
});
```

Simulate policy decisions:

```bash
forge policy simulate tickets.create --role member --json
forge inspect policies --json
```

When a user receives 403:

```bash
forge telemetry inspect <traceId>
forge policy simulate <policyName> --role <role> --json
```

See [Troubleshooting — Policy and auth errors](troubleshooting.md#policy-and-auth-errors).

## Tenant isolation

Tenant-scoped tables declare `tenantId` in `src/forge/schema.ts`. Generated metadata includes:

- `tenantScope.json` — which tables are tenant-bound
- `permissionMatrix.json` — role × policy matrix
- `rlsPolicies.sql` — Postgres RLS when enabled

Commands and queries must respect tenant scope. Agent tools and auto-tools inherit the same auth/tenant context as runtime handlers.

## Secrets and environment

Recipes and integrations register **secret names** — never values — in `secretRegistry.json`:

```bash
forge inspect secrets --json
forge secrets list --json
forge env check --json
```

At runtime in actions, workflows, and endpoints:

```typescript
const key = ctx.secrets.get("STRIPE_SECRET_KEY");
```

Forbidden in commands, queries, liveQueries, and client code:

```typescript
process.env.STRIPE_SECRET_KEY; // FORGE_SECRET_LEAK / guard violation
```

Configure values in `.env` (gitignored). List expected names:

```bash
forge env list --json
```

## Database

Forge compiles schema to SQL DDL and migration plans:

```bash
forge db diff --json
forge db migrate --db pglite
forge db status --json
forge db reset --db pglite   # local dev only
```

Local dev often uses PGlite; production uses Postgres with optional RLS enforcement.

### Row Level Security (RLS)

For Postgres deployments, Forge can compile tenant rules to database-enforced RLS:

```bash
forge rls inspect --json
forge rls check --json
```

Generated artifacts:

- `src/forge/_generated/rlsPolicies.sql`
- `src/forge/_generated/dbSecurityManifest.json`

RLS complements application-level policies — it blocks cross-tenant reads even if application code regresses.

PGlite local dev may not treat RLS as production-authoritative. Run `forge rls check` before shipping Postgres deployments.

## Data workflow for new tables

```bash
# 1. Edit schema
# src/forge/schema.ts — include tenantId when tenant-scoped

forge generate
forge db diff
forge db migrate --db pglite
forge rls check --json
forge verify --standard
```

Or scaffold with:

```bash
forge make resource tickets --fields title:text --dry-run --json
```

See [Authoring](authoring.md).

## Security checklist

Before production:

```bash
forge check --json
forge auth check --json
forge secrets check --json
forge rls check --json
forge verify --strict
```

Ensure:

- Production auth mode is `jwt` or `oidc`
- No `process.env` in app handlers
- No network SDKs in commands/queries/liveQueries
- Tenant-scoped tables include `tenantId`
- Webhook endpoints verify signatures (see [Payments](payments.md))

## Related pages

- [Runtime Model](runtime-model.md) — what each context may access
- [forge add](forge-add.md) — integration secrets and runtime matrix
- [Frontend](frontend.md) — `ForgeProvider` and dev auth
- [Payments](payments.md) — webhook verification pattern
