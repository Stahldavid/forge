# Self-Host

ForgeOS can emit **deployment artifacts** and run **self-host checks** for running generated apps outside local `forge dev`.

This page covers the supported self-host workflow — not a specific cloud vendor.

## Generate deployment artifacts

```bash
forge self-host compose
forge self-host check --json
```

Typical outputs (paths vary by app):

| Artifact | Purpose |
|----------|---------|
| `deploy/docker-compose.yml` | Local/production compose stack |
| `deploy/.env.example` | Required environment variable names |
| Generated deploy manifest | Runtime URLs, secrets, health checks |

Review `deploy/.env.example` for secret **names** before deploying. Never commit real secret values.

## Check before deploy

```bash
forge self-host check --json
```

Validates:

- Required secrets are declared
- Auth mode is appropriate for non-dev deployment
- Database adapter configuration is coherent
- Generated deploy manifest matches current app graph

Fix issues surfaced by `forge check` and `forge verify --strict` first.

## Production auth

Self-hosted deployments must use **`jwt`** or **`oidc`** — not `dev-headers`.

```bash
forge auth check --json
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
forge self-host compose
forge self-host check --json
forge verify --strict
```

Playbook reference: `src/forge/_generated/operationPlaybooks.md` → **Self-host**.

## Related pages

- [Security and Data](security-and-data.md) — auth, secrets, RLS
- [Release](release.md) — npm package publishing (framework repo)
- [Field Testing](field-testing.md) — validate installs before deploy
