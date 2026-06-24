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

## Related pages

- [Getting Started](getting-started.md)
- [Release](release.md)
- [Troubleshooting — npm / field test failures](troubleshooting.md#npm-field-test-failures)
