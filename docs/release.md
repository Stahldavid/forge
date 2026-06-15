# Release

ForgeOS is published to npm as **`forgeos`** with dist-tag **`alpha`**.

Related packages:

| Package | Purpose |
|---------|---------|
| `forgeos@alpha` | Framework, compiler, CLI, templates |
| `create-forge-app@alpha` | `npm create forge-app@alpha` scaffolding wrapper |

Current release line: **`forgeos@alpha`**. See [Changelog](changelog.md) for version history and `npm view forgeos dist-tags --json` for the registry state.

## Public Quickstart Validation

Before promoting a release, validate the external install path:

```bash
npm create forge-app@alpha smoke-app -- --template minimal-web --no-git
cd smoke-app
npm run generate
npm run forge -- check --json
```

Or use the field-test harness from the framework repository:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web,b2b-support-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --json
```

See [Field Testing](field-testing.md).

## Alpha Release (maintainers)

```bash
npm run release:publish-local-alpha -- --dry-run
npm run release:smoke
npm run release:publish-alpha
```

The package uses the `alpha` dist-tag while the project is in private/public MVP hardening.

## Trusted Publishing (npm)

npm Trusted Publishing should point to:

- Repository: `Stahldavid/forge`
- Workflow file: `publish.yml`
- Package: `forgeos`

The GitHub workflow uses OIDC provenance for npm publishing. Local publish is intentionally limited to tarball validation by default because the npm package is configured for Trusted Publisher plus strict 2FA/token settings. `npm run release:publish-alpha` verifies the version is not already published, checks that the current commit is pushed, dispatches `publish.yml`, and watches the run.

## GitHub Packages mirror

The repository also publishes scoped mirrors to GitHub Packages via `.github/workflows/github-packages.yml`. This is useful for organizations that prefer installing from `npm.pkg.github.com` instead of the public npm registry.

Maintainers trigger the workflow on `main` pushes or tags matching `v*` / `forgeos-v*`.

## Before a Public Tag

Run:

```bash
npm run release:smoke
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --json
forge verify --strict
```

Use the broad field-test workflow before promoting a release beyond alpha.

## Version alignment

Release checks verify that:

- `package.json` version matches `src/forge/version.ts`
- Generated artifact headers use the same generator version

Run locally:

```bash
bun test tests/release/version-alignment.test.ts
```
