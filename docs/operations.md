# Operations

ForgeOS favors repository-native operations: generated artifacts, explicit checks, self-host files, and machine-readable diagnostics.

Use this page when preparing a local app for production-like operation, debugging platform issues, or validating a release.

For a maturity matrix by subsystem, read [Production Readiness](production-readiness.md) before treating an app as production-ready.

## Health check

```bash
forge doctor
forge doctor --json
forge dev --once --json
```

`forge doctor` answers whether the project is coherent. `forge dev --once --json` adds local runtime, frontend, capability, and previous report context.

## Production auth

Production should use `jwt` or `oidc`, not `dev-headers`.

```bash
forge auth check --json
```

Verify:

- issuer;
- audience;
- JWKS URI;
- algorithms;
- tenant claim;
- bearer token header.

See [Security and Data](security-and-data.md).

## Database and RLS

```bash
forge db diff --json
forge db migrate --db pglite
forge rls check --json
```

For tenant-scoped tables, app-level tenant checks and Postgres RLS should agree.

## LiveQuery production health

```bash
forge inspect live-production --json
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

Production liveQuery relies on durable invalidations. In-memory notifications are wakeups, not the source of truth.

## Self-host

```bash
forge self-host compose
forge self-host check --json
```

Self-host artifacts should be generated and checked before deployment.

## Windows native diagnostics

```powershell
forge doctor windows --json
forge setup windows --json
node .\bin\forge.mjs doctor windows --json
node .\bin\forge.mjs setup windows --json
```

Checks include Node, npm, Git, Bun resolution, suspicious Bun shims, Git long paths, PowerShell policy, and symlink support.

## Node and Bun

ForgeOS is Bun-first but not Bun-only. The CLI has a Node path:

```bash
node ./bin/forge.mjs dev --once --json
npm run forge:node -- inspect framework --json
```

Use Node when validating npm package behavior or Windows compatibility.

## Release validation

```bash
npm run release:smoke
npm run field:test -- --dry-run --json
```

Before publishing:

- verify version alignment;
- run package smoke;
- create a fresh app from the packed tarball;
- run `forge dev --once --json` inside the fresh app;
- check public docs and changelog.

## Timeouts

Long checks should fail predictably:

```bash
forge verify --strict --script-timeout-ms 1800000 --json
forge test run --changed --timeout-ms 120000 --json
```

Timeout diagnostics should include the command, step, duration, and failure kind.

## Related pages

- [Self-Host](self-host.md)
- [Production Readiness](production-readiness.md)
- [Release](release.md)
- [Field Testing](field-testing.md)
- [Troubleshooting](troubleshooting.md)
