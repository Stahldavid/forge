# Field Testing

Field testing checks ForgeOS outside the framework workspace, using newly generated apps.

## Local Field Test

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
