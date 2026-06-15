# Release

ForgeOS is published to npm as `forgeos`.

## Alpha Release

```bash
npm run release:publish-local-alpha -- --dry-run
npm run release:smoke
npm run release:publish-alpha
```

The package uses the `alpha` dist-tag while the project is in private/public MVP hardening.

## Trusted Publishing

npm Trusted Publishing should point to:

- Repository: `Stahldavid/forge`
- Workflow file: `publish.yml`
- Package: `forgeos`

The GitHub workflow uses OIDC provenance for npm publishing. Local publish is intentionally limited to tarball validation by default because the npm package is configured for Trusted Publisher plus strict 2FA/token settings. `npm run release:publish-alpha` verifies the version is not already published, checks that the current commit is pushed, dispatches `publish.yml`, and watches the run.

## Before a Public Tag

Run:

```bash
npm run release:smoke
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "npm:forgeos@alpha" --install --json
forge verify --strict
```

Use the broad field-test workflow before promoting a release beyond alpha.
