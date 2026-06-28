# Self-Host

ForgeOS can emit **deployment artifacts** and run production readiness checks for running generated apps outside local `forge dev`.

This page covers the supported self-host workflow — not a specific cloud vendor.

## Generate deployment artifacts

```bash
forge deploy plan --target docker --json
forge deploy render docker
```

Typical outputs (paths vary by app):

| Artifact | Purpose |
|----------|---------|
| `deploy/docker-compose.yml` | Local/production compose stack |
| `deploy/.env.production.example` | Required production environment variable names |
| Generated deploy manifest | Runtime URLs, secrets, health checks |

The generated Dockerfile and Compose commands use the app's detected package manager (`npm`, `pnpm`, `yarn`, or `bun`) instead of assuming npm. Production checks require the matching lockfile (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `bun.lockb`) so Docker builds are reproducible; without a lockfile the Dockerfile falls back to a normal install and `forge deploy check --production` blocks release.

Review `deploy/.env.production.example` for secret **names** before deploying. Copy it to `deploy/.env.production` or provide equivalent values through the environment before running the production gate. `forge deploy check --production` reads `deploy/.env.production` for `DATABASE_URL`, `FORGE_AUTH_MODE`, issuer, audience, JWKS/discovery, and provider secret names. The generated Docker Compose stack also uses `deploy/.env.production` through `env_file` and does not inject a hidden `DATABASE_URL` override into the Forge services. Never commit real secret values.

## Check before deploy

```bash
forge deploy check --production --json
```

Validates:

- Required secrets are declared
- Auth mode is `jwt` or `oidc`
- Package-manager lockfile is present
- Production auth issuer/audience/JWKS settings are present
- Database readiness is present
- Public `auth.md` and OAuth protected-resource metadata are generated
- A field-test report exists with runtime and auth probes
- Tenant claim mapping is present when required
- Generated artifacts match the current app graph

Fix issues surfaced by `forge check`, `forge verify --smoke`, and `forge field-test run --runtime-probes --auth-probes --json` before public traffic.

## Production auth

Self-hosted deployments must use **`jwt`** or **`oidc`** — not `dev-headers`.

```bash
forge auth check --production --json
```

See [Security and Data](security-and-data.md).

## Database

Production typically uses Postgres with migrations:

```bash
forge db migrate
forge db status --json
forge rls check --json
```

Apply RLS policies when tenant isolation must be DB-enforced.

## LiveQuery in production

Production liveQuery relies on:

- Durable invalidation log (`_forge_live_invalidations`)
- SSE or long-polling wakeups
- Postgres NOTIFY as optional wakeup — **not** the source of truth

See [Frontend — LiveQuery](frontend.md#livequery).

## Release debugging

When symbolicated stack traces are configured:

```bash
forge release inspect <releaseId> --json
forge release sourcemaps symbolicate --input stacktrace.json --json
forge telemetry inspect <traceId> --with-release --json
```

## Agent workflow

```bash
forge do "prepare self-host deployment" --json
forge deploy render docker
forge deploy check --production --json
forge field-test run --runtime-probes --auth-probes --json
forge verify --smoke
```

Playbook reference: `src/forge/_generated/operationPlaybooks.md` → **Self-host**.

## Related pages

- [Security and Data](security-and-data.md) — auth, secrets, RLS
- [Release](release.md) — npm package publishing (framework repo)
- [Field Testing](field-testing.md) — validate installs before deploy
