# Field Report: WorkOS Real Vendor Access

Date: 2026-07-04

This report documents the production-shaped ForgeOS + WorkOS path validated
against a real WorkOS hosted environment. It is intentionally redacted: no
secret values, API keys, cookies, or tokens are included.

## Scope

App:

```text
vendor-access
```

Package channel:

```text
forgeos@alpha
```

Auth provider:

```text
WorkOS AuthKit + RBAC permission claims
```

Deploy target under test:

```text
Docker readiness path
```

FGA:

```text
Not enabled. This app uses AuthKit, RBAC permission claims, Forge policies, and
tenant isolation. WorkOS FGA remains optional for apps that need
resource-level authorization outside normal role/permission checks.
```

## Golden Path

The intended reproduction path is:

```bash
forge golden-path plan --auth workos --target docker --real --production --json
forge field-test create vendor-access --auth workos --template vendor-access --package-manager npm --install --git --json
cd vendor-access
npm run forge -- add auth workos --json
npm run forge -- authmd generate --json
npm run forge -- authmd check --json
npm run forge -- workos doctor --json
npm run forge -- workos seed --file workos-seed.yml --dry-run --json
npm run forge -- workos setup --real --file workos-seed.yml --json
npm run forge -- workos prove --real --file workos-seed.yml --json
npm run forge -- auth prove --scenario multi-tenant --json
npm run forge -- field-test run --realistic --json
npm run forge -- field-test report --json
npm run forge -- deploy readiness --production --json
```

For an existing app:

```bash
forge golden-path status --real --production --json
```

## Evidence Captured

The real WorkOS app validated these properties:

- WorkOS CLI setup was usable without opening the dashboard for redirect URI,
  CORS origin, homepage URL, and seed application.
- `workos-seed.yml` covered the app's active Forge policy permissions.
- Re-running hosted seed/setup treated existing WorkOS resources as idempotent
  state instead of ambiguous failure.
- The app exposed `public/auth.md` and
  `public/.well-known/oauth-protected-resource`.
- `HEAD` and `GET` probes for `/auth.md` and
  `/.well-known/oauth-protected-resource` returned successful responses in the
  local runtime.
- Real AuthKit login reached the Forge app and produced a session visible to
  the web bridge.
- WorkOS organization claims were normalized into Forge tenant context.
- The Forge runtime denied missing permissions and cross-tenant access through
  policies and tenant checks.
- `forge field-test run --realistic --json` passed for the vendor-access
  template with runtime, auth metadata, UI, seed, permission-denial, and
  cross-tenant probes.
- `forge deploy readiness --production --json` correctly separated local app
  evidence from production deploy evidence.

## Commands That Passed

Representative commands:

```bash
npm run forge -- workos doctor --json
npm run forge -- workos seed --file workos-seed.yml --dry-run --json
npm run forge -- workos prove --real --file workos-seed.yml --json
npm run forge -- authmd generate --json
npm run forge -- authmd check --json
npm run forge -- check --json
npm run typecheck
npm run forge -- dev --once --json
npm run forge -- verify --smoke --json
npm run forge -- field-test run --realistic --json
npm run forge -- field-test report --json
```

## Production Blockers Observed

`forge deploy readiness --production --json` stayed blocked until deploy
production evidence was supplied. That is expected.

The important blockers were:

- production `DATABASE_URL` must exist in the environment or
  `deploy/.env.production`;
- production auth must be `jwt` or `oidc`, not local `dev-headers`;
- a production deployment must be verified with a public URL:

```bash
forge deploy verify --production --url https://app.example.com --json
```

## Result

The ForgeOS P0 path is now concrete enough for repeatable evaluation:

```text
create app -> add/prove WorkOS -> field-test -> deploy readiness -> package -> verify
```

The remaining production proof is not WorkOS setup. It is a real public deploy
with production database credentials and a public URL for `forge deploy verify`.
