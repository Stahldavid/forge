# Field Testing

Field testing checks ForgeOS outside the framework workspace, using newly generated apps.

## Recommended External Path

Validate the same path external users take:

```bash
npm create forge-app@alpha smoke-app -- --template minimal-web --no-git
cd smoke-app
npm run generate
npm run forge -- check --json
npm run forge -- verify --standard
```

The `create-forge-app@alpha` wrapper delegates to `forge new` with defaults:

```txt
--template minimal-web
--package-manager npm
--forge-spec npm:forgeos@alpha
```

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
  --json
```

Run against the published alpha package:

```bash
npm run field:test -- \
  --package-managers npm,pnpm,yarn,bun \
  --templates minimal-web,b2b-support-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --json
```

## CI Coverage

The repository includes a broad field-test workflow for Linux, macOS, Windows, Node 22, Node 24, and major package managers. It is intended for scheduled and manual validation rather than every edit.

The regular CI still keeps a smaller smoke test so pull requests remain usable.

## Related pages

- [Getting Started](getting-started.md)
- [Release](release.md)
- [Troubleshooting — npm / field test failures](troubleshooting.md#npm--field-test-failures)
