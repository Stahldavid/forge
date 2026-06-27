# Field Testing

Field testing checks ForgeOS outside the framework workspace, using newly generated apps.

It is different from unit tests:

- unit tests validate compiler/runtime internals;
- smoke tests validate that a generated app can run Forge commands;
- runtime probes validate a newly generated app through its HTTP API, the same way a user or frontend would.

## Recommended External Path

Validate the same path external users take:

```bash
npm create forgeos-app@alpha smoke-app -- --template minimal-web --no-git
cd smoke-app
npm run generate
npm run forge -- check --json
npm run forge -- verify --standard
```

The `create-forgeos-app@alpha` wrapper delegates to `forge new` with defaults:

```txt
--template minimal-web
--package-manager npm
--forge-spec npm:forgeos@alpha
```

## Real Runtime Probe

Use the repository harness when you want proof that a fresh app can be created, installed, generated, checked, started, and called through the runtime API:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --write-report field-reports/npm-minimal-web.json \
  --json
```

With `--runtime-probes`, the harness:

1. creates the app in a temporary directory;
2. installs dependencies using the selected package manager;
3. runs `generate`;
4. runs `forge dev --once --json`;
5. runs `forge verify --smoke --json`;
6. starts `forge dev --api-only --port 0 --json`;
7. waits for `GET /health`;
8. calls `GET /entries`;
9. calls a template command through `POST /commands/...`;
10. calls a template query through `POST /queries/...`;
11. writes an optional JSON report with commands, durations, status codes, and trace IDs.

The minimal and Nuxt template probes create a note with `createNote` and confirm it is returned by `listNotes`. The B2B support template probe creates a ticket with `createTicket` and confirms it is returned by `listTickets`.

Add `--auth-probes` when the report should also prove the auth/agent-ready path in the generated app:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --auth-probes \
  --write-report field-reports/npm-minimal-web-auth.json \
  --json
```

With `--auth-probes`, the harness additionally runs:

1. `forge add auth workos --json`;
2. `forge authmd generate --json`;
3. `forge authmd check --json`;
4. `forge workos doctor --json`;
5. `forge workos seed --file workos-seed.yml --dry-run --json`;
6. `forge auth prove --scenario multi-tenant --json`;
7. `HEAD` and `GET` probes for `/auth.md`;
8. `HEAD` and `GET` probes for `/.well-known/oauth-protected-resource`.

This mode is still local and non-destructive: WorkOS seeding is dry-run by default, and the multi-tenant proof verifies the generated local contract, seed, auth metadata, and claim mapping without requiring real WorkOS credentials.

## Local Field Test (framework repo)

Run a dry plan:

```bash
npm run field:test -- --dry-run --json
```

Run a real minimal npm test against the local workspace:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "file:." \
  --install \
  --runtime-probes \
  --auth-probes \
  --json
```

Run against the published alpha package:

```bash
npm run field:test -- \
  --package-managers npm,pnpm,yarn,bun \
  --templates minimal-web,nuxt-web,b2b-support-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --json
```

## CI Coverage

The repository includes a broad field-test workflow for Linux, macOS, Windows, Node 22, Node 24, and major package managers. It is intended for scheduled and manual validation rather than every edit.

The workflow runs runtime probes and uploads a `field-report-...` artifact for each matrix cell. These reports are useful when deciding whether an alpha release is ready to promote or whether a Windows/package-manager regression needs a fix.

The regular CI still keeps a smaller smoke test so pull requests remain usable.

## Interpreting a report

Each result includes:

- `template`;
- `packageManager`;
- `appDir` when `--keep` is used;
- `steps` with command, duration, exit code, timeout state, stdout/stderr snippets;
- `runtime.serverUrl` when runtime probes are enabled;
- HTTP probe steps with status and trace IDs.

A passing runtime probe means the generated app was not merely scaffolded; it accepted real runtime calls through Forge's HTTP boundary.

## Field report contract

When publishing or reviewing field reports, include enough context for another maintainer to reproduce the result:

- ForgeOS version or commit;
- package source, such as `npm:forgeos@alpha`, a packed tarball, or `file:.`;
- OS, architecture, Node version, and package manager version;
- template and install mode;
- command transcript or JSON report path;
- runtime probe status codes and trace IDs;
- whether generated artifacts were ignored or regenerated;
- failures, retries, and manual steps.

For public alpha promotion, prefer a small set of high-signal reports over a broad list of unverified claims:

- one Linux npm `minimal-web` report with runtime probes;
- one Windows npm `minimal-web` report with runtime probes;
- one macOS report for a non-minimal template;
- one package-manager variation report, such as pnpm or Bun;
- one failure report that documents the diagnostic and fix.

Field reports should complement agent evals. Field tests prove that generated apps run outside the repository; evals prove that agents can change those apps safely.

## Related pages

- [Getting Started](getting-started.md)
- [Release](release.md)
- [Troubleshooting — npm / field test failures](troubleshooting.md#npm-field-test-failures)
