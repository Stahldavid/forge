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
forge authmd generate
forge authmd check --json
forge inspect auth --json
```

Production deployments must not rely on `dev-headers`. Forge emits guardrails when dev auth is enabled in production-like modes.

`forge authmd generate` writes `public/auth.md`, an agent-readable public authorization summary derived from `agentContract.json`, and `public/.well-known/oauth-protected-resource`, a JSON protected-resource metadata document for automated clients. It lists protected resource metadata, claim mapping, tenant requirements, commands, queries, liveQueries, policies, and agent-tool risk/approval metadata. Use `forge authmd check --json` in CI to catch drift across both files.

When `public/auth.md` or `public/.well-known/oauth-protected-resource` exists, `forge dev` serves them at `GET /auth.md` and `GET /.well-known/oauth-protected-resource` so agents and authorization-aware clients can discover the public authorization surface from the runtime.

For WorkOS, `forge add auth workos` also emits `Request -> Response` AuthKit handlers for `/login`, `/callback`, `/logout`, and `/session`, a webhook handler for `POST /webhooks/workos`, permission-first Forge policy templates, and FGA helpers that can assert a resource belongs to the organization being checked. `forge dev` exposes the generated AuthKit routes and `POST /webhooks/workos` automatically when the WorkOS artifacts are present, reads WorkOS env values from the loaded env files, signs local AuthKit session cookies, verifies `WorkOS-Signature` with `WORKOS_WEBHOOK_SECRET`, and rejects replayed event ids. `forge workos doctor --json` verifies the generated seed, demo organizations, resource types, roles, permissions, AuthKit route helper, session helper, webhook handler, signature verifier, and cross-tenant FGA guard.

For resource-level WorkOS FGA, Forge generates `syncWorkOSResourceGraph(...)`, `workOSResourceRecords(...)`, `canWorkOS(...)`, and `ForgeWorkOSFgaDecisionCache`. The sync helper mirrors Forge app resources into WorkOS authorization resources. The check helper uses the WorkOS Authorization API shape `organizationMembershipId`, `permissionSlug`, `resourceTypeSlug`, and `resourceExternalId`, with optional telemetry and deny-by-default fallback. Keep those calls in server/action/workflow/endpoint code; command/query/liveQuery policies should continue to use deterministic claim checks such as `canPermission(...)`.

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
forge rls check --json
forge rls test --db postgres --json
forge rls mutate-test --json
```

Generated artifacts:

- `src/forge/_generated/rlsPolicies.sql`
- `src/forge/_generated/dbSecurityManifest.json`

RLS complements application-level policies — it blocks cross-tenant reads even if application code regresses.

PGlite local dev may not treat RLS as production-authoritative. Run `forge rls check` before shipping Postgres deployments.
Run `forge rls mutate-test --json` to verify that generated RLS artifacts fail closed when FORCE RLS, policies, predicates, or runtime roles are weakened.

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
forge rls mutate-test --json
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
- [Production Readiness](production-readiness.md) — maturity matrix and production checklist
- [Threat Model](threat-model.md) — public security boundaries, threats, and mitigations
- [forge add](forge-add.md) — integration secrets and runtime matrix
- [Frontend](frontend.md) — `ForgeProvider` and dev auth
- [Payments](payments.md) — webhook verification pattern
