# Release

ForgeOS is published to npm as `forgeos`.

## Alpha Release

```bash
npm run release:smoke
npm run release
```

The package uses the `alpha` dist-tag while the project is in private/public MVP hardening.

## Trusted Publishing

npm Trusted Publishing should point to:

- Repository: `Stahldavid/forge`
- Workflow file: `publish.yml`
- Package: `forgeos`

The GitHub workflow uses OIDC provenance for npm publishing. Local emergency alpha publishing uses the repository script and disables provenance because OIDC is only available in CI.

## Before a Public Tag

Run:

```bash
npm run release:smoke
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "npm:forgeos@alpha" --install --json
forge verify --strict
```

Use the broad field-test workflow before promoting a release beyond alpha.
