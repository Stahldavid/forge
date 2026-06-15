# Contributing

ForgeOS uses Changesets for npm versioning and GitHub Actions Trusted Publishing for npm release authentication.

## Local Checks

```bash
bun run typecheck
bun test --timeout 120000
node ./bin/forge.mjs verify --standard --script-timeout-ms 120000
npm run release:smoke
```

## Changesets

For changes that should be published, add a changeset:

```bash
npm run changeset
```

The release workflow opens or updates a version PR from pending changesets. Merging that version PR publishes packages through npm Trusted Publishing.

Current prerelease automation publishes with the `alpha` dist-tag.

## npm Trusted Publisher Setup

Configure the npm package `forgeos` with:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization/user | `Stahldavid` |
| Repository | `forge` |
| Workflow filename | `publish.yml` |
| Environment | blank |
| Allowed action | `npm publish` |

Do not configure `NPM_TOKEN` for normal releases. The publish workflow uses GitHub OIDC with `id-token: write`, Node 24, npm 11+, and provenance. In npm package settings, prefer "Require two-factor authentication and disallow tokens"; Trusted Publishers continue to work with that stricter token setting.

## Manual Publish

Manual publish exists only as a controlled fallback. For the first
`0.1.0-alpha.0` package creation, run:

```bash
npm run release:smoke
npm run release:publish-local-alpha -- --dry-run
npm run release:publish-local-alpha -- --yes
```

After the npm package exists and Trusted Publishing is configured, prefer:

```bash
gh workflow run publish.yml
```

Tag fallback accepts `v*` and `forgeos-v*` tags, but the tag version must match `package.json`.
