# Field Testing

Field testing checks ForgeOS outside the framework workspace, using newly generated apps.

It is different from unit tests:

- unit tests validate compiler/runtime internals;
- smoke tests validate that a generated app can run Forge commands;
- runtime probes validate a newly generated app through its HTTP API, the same way a user or frontend would.

## Recommended External Path

Validate the same path external users take:

```bash
forge field-test create vendor-access --auth workos --install --git --json
cd vendor-access
npm run forge -- field-test run --realistic --json
npm run forge -- field-test report --json
npm run forge -- deploy plan --target docker --json
npm run forge -- deploy check --production --json
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
forge field-test run \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --runtime-probes \
  --ui-probes \
  --write-report field-reports/npm-minimal-web.json \
  --json
```

For the full WorkOS/auth/UI/runtime path, prefer the compact alias:

```bash
forge field-test run --realistic --templates vendor-access --package-managers npm --forge-spec "npm:forgeos@alpha" --json
```

`--realistic` enables runtime probes, auth probes, and UI probes together. It
also defaults to the `vendor-access` WorkOS path when no template/auth override
is provided.

With `--runtime-probes`, the harness:

1. creates the app in a temporary directory;
2. installs dependencies using the selected package manager;
3. runs `generate`;
4. runs `forge dev --once --json`;
5. runs `forge verify --smoke --json`;
6. starts `forge dev --api-only --port 0 --json`;
7. waits for `GET /health`;
8. calls `GET /entries`;
9. runs `forge seed status/dev/reset` against the same runtime when a seed command is present;
10. calls a template command through `POST /commands/...`;
11. calls a template query through `POST /queries/...`;
12. writes an optional JSON report with commands, durations, status codes, and trace IDs.

The minimal and Nuxt template probes create a note with `createNote` and confirm it is returned by `listNotes`. The B2B support template probe creates a ticket with `createTicket` and confirms it is returned by `listTickets`. The vendor-access template probe uses `forge seed dev --all-tenants` to seed the discovered local tenants, confirms each tenant only sees its own vendors, proves an owner can approve a request, proves a requester cannot approve, and proves a cross-tenant approval fails.

Seed probes are automatic for templates such as `vendor-access`, where the
runtime graph exposes `seedVendorAccessDemo`. They catch empty-first-run
regressions and prove the same seed/reset path used by the UI is reachable from
the ForgeOS CLI. The `seed-status` probe also records `readiness`, including
the selected seed command, whether `npm run dev` seeds all discovered local
tenants, and the exact empty-workspace recovery commands.

Add `--ui-probes` when the report should also prove that the generated web
entrypoint starts beside the API. With UI probes enabled, the harness starts
`forge dev` with dynamically selected API and web ports, waits for the web
server, and records a `GET /` probe for the template HTML. It also records
`forge inspect ui --ergonomics --json` evidence so the field report can warn
when a generated app has no primary workflow action, workflow navigation,
permission feedback, or keeps ForgeOS/demo copy in the primary product surface.
Use `forge ui smoke` for deeper DOM, interaction, screenshot, and
Playwright-backed assertions.

Add `--auth-probes` when the report should also prove the auth/agent-ready path in the generated app:

```bash
forge field-test run \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --runtime-probes \
  --auth-probes \
  --ui-probes \
  --write-report field-reports/npm-minimal-web-auth.json \
  --json
```

With `--auth-probes`, the harness additionally runs:

1. `forge add auth workos --json`;
2. `forge authmd generate --json`;
3. `forge authmd check --json`;
4. `forge workos doctor --json`;
5. `forge workos seed --file workos-seed.yml --dry-run --json`;
6. `forge workos prove --file workos-seed.yml --json`;
6. `forge auth prove --scenario multi-tenant --json`;
7. `HEAD` and `GET` probes for `/auth.md`;
8. `HEAD` and `GET` probes for `/.well-known/oauth-protected-resource`.

This mode is still local and non-destructive: WorkOS seeding is dry-run by default, and the multi-tenant proof verifies the generated local contract, seed, auth metadata, and claim mapping without requiring real WorkOS credentials.

## Local Field Test (framework repo)

Run a dry plan:

```bash
forge field-test run --dry-run --json
```

Run a real minimal npm test against the local workspace:

```bash
forge field-test run \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "file:." \
  --runtime-probes \
  --auth-probes \
  --ui-probes \
  --json
```

Run against the published alpha package:

```bash
forge field-test run \
  --package-managers npm,pnpm,yarn,bun \
  --templates minimal-web,nuxt-web,b2b-support-web,vendor-access \
  --forge-spec "npm:forgeos@alpha" \
  --runtime-probes \
  --auth-probes \
  --ui-probes \
  --json
```

`npm run field:test -- ...` remains available inside the framework repository for CI and legacy scripts. Prefer `forge field-test ...` in docs, release notes, and handoffs because it is the user-facing contract.

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

`forge field-test report --json` also returns `summary.productionEvidence`.
`productionEvidence.readyForDeployCheck` means the report itself is good enough
for the field-test portion of `forge deploy check --production`: the report
passed, runtime probes ran, auth probes ran, UI probes ran, UI ergonomics audit
evidence was captured, and no case failed. It does not
claim the app is production-ready by itself; `forge deploy check --production`
still validates production auth mode, database evidence, package-manager
lockfiles, public auth metadata, WorkOS posture, hosted WorkOS seed evidence
for WorkOS-backed apps, and tenant claims.

The report command checks concrete probe evidence, not just enabled flags. A
deploy-check-ready report must include successful runtime health and `/entries`
probes, WorkOS/auth setup commands, `HEAD` and `GET` probes for `/auth.md` and
`/.well-known/oauth-protected-resource`, at least one web UI probe, and the UI
ergonomics audit result.

For the `vendor-access` template, deploy-check-ready evidence also requires the
domain probes that make the app valuable as a production-shaped test: seed all
discovered local tenants, query each tenant without leaking the other tenant's
organization, approve a request as an owner/security persona, deny approval for
a requester, deny a cross-tenant approval attempt, and include seed readiness
evidence for recovering an empty workspace.

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
