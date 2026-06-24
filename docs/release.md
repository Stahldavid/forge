# Release

ForgeOS is published to npm as **`forgeos`** with dist-tag **`alpha`**.

Related packages:

| Package | Purpose |
|---------|---------|
| `forgeos@alpha` | Framework, compiler, CLI, templates |
| `create-forgeos-app@alpha` | `npm create forgeos-app@alpha` scaffolding wrapper |

Current release line: **`forgeos@alpha`**. During alpha, use the `@alpha` tag explicitly; `latest` is not the active release channel and may intentionally lag while a prerelease hardens. See [Changelog](changelog.md) for version history and `npm view forgeos dist-tags --json` for the registry state.

## Public Quickstart Validation

Before promoting a release, validate the external install path:

```bash
npm create forgeos-app@alpha smoke-app -- --template minimal-web --no-git
cd smoke-app
npm run generate
npm run forge -- check --json
```

Or use the field-test harness from the framework repository:

```bash
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web,nuxt-web,b2b-support-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --write-report field-reports/release-smoke.json \
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

`latest` promotion is a separate maintainer decision. Trusted Publishing can publish `forgeos@alpha` through OIDC without an npm token, but moving `latest` requires npm write authentication. Configure `NPM_TOKEN` only when maintainers intentionally want the publish workflow to run `npm dist-tag add forgeos@<version> latest`; otherwise the workflow skips that step and leaves `latest` unchanged.

Use `forge release doctor --json` before publishing when you need the Forge-native
readiness aggregate. It checks prepared release state, sourcemaps, self-host
readiness, docs, and the npm package contents via `npm pack --dry-run --json`.

## Trusted Publishing (npm)

npm Trusted Publishing should point to:

- Repository: `Stahldavid/forge`
- Workflow file: `publish.yml`
- Package: `forgeos`

The GitHub workflow uses OIDC provenance for npm publishing. Local publish is intentionally limited to tarball validation by default because the npm package is configured for Trusted Publisher plus strict 2FA/token settings. `npm run release:publish-alpha` verifies the version is not already published, checks that the current commit is pushed, dispatches `publish.yml`, and watches the run.

The public create wrapper is published as `create-forgeos-app@alpha`. The first publish of that package requires npm CLI authentication by a maintainer:

```bash
npm login
node scripts/publish-npm-alpha-package.mjs packages/create-forge-app --allow-first-publish
```

Alternatively, configure npm Trusted Publisher for `create-forgeos-app` with the same repository/workflow and dispatch the trusted publish workflow with first-publish enabled:

```bash
npm run release:publish-alpha -- --allow-create-first-publish
```

After the package exists and Trusted Publisher is configured for it, `publish.yml` can publish future versions automatically.

## Security Release Gate

The publish workflow runs:

```bash
npm run forge -- security prove --db postgres --full --json
npm run forge -- rls mutate-test --json
npm run release:evidence
npm run security:deps
npm run release:verify-public-alpha
```

before or after the relevant packaging/publishing phase. The public registry smoke retries npm dist-tag lookups while the registry propagates. If `create-forgeos-app` is still waiting for its first maintainer-authorized publish, the workflow verifies `forgeos@alpha` with `--skip-create`; after the wrapper exists, it verifies both packages. This gate aggregates Forge guard checks, auth proof, secrets proof, Postgres RLS proof, structural RLS mutation proof, invariant test status when source fixtures are present, release supply-chain evidence, a basic CycloneDX SBOM, dependency vulnerability evidence, and a public registry smoke for `forgeos@alpha` plus `create-forgeos-app@alpha` when available. The dedicated security assurance workflow uploads `security/evidence/latest/security-proof.json` plus split invariant artifacts.

See [Security Standards Crosswalk](security-standards.md) for the public mapping from controls to evidence.

## GitHub Packages mirror

The repository also publishes scoped mirrors to GitHub Packages via `.github/workflows/github-packages.yml`. This is useful for organizations that prefer installing from `npm.pkg.github.com` instead of the public npm registry.

Maintainers trigger the workflow on `main` pushes or tags matching `v*` / `forgeos-v*`.

## Before a Public Tag

Run:

```bash
npm run release:smoke
npm run release:evidence
npm run security:deps
npm run release:verify-public-alpha
npm run field:test -- \
  --package-managers npm \
  --templates minimal-web,nuxt-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --write-report field-reports/pre-tag-minimal-web.json \
  --json
forge verify --strict
forge security prove --db postgres --full --json
```

Use the broad field-test workflow before promoting a release beyond alpha. It runs Linux, macOS, Windows, Node 22, Node 24, npm, pnpm, yarn, and Bun matrix cells with runtime probes and JSON artifacts.

## Documentation checklist

Before tagging a public release, verify the public documentation path:

```bash
python -m mkdocs build --strict --site-dir .site-check
bun test tests/docs/readthedocs.test.ts
```

Check these items:

- `README.md` points to `https://forgeos.readthedocs.io/`.
- `docs/getting-started.md` shows `npm create forgeos-app@alpha`.
- `docs/why-forgeos.md` explains the agent-native contract.
- `docs/production-readiness.md` matches the current alpha maturity and known limits.
- `docs/threat-model.md` matches current auth, policy, RLS, secrets, package, frontend, and AI-agent behavior.
- `docs/changelog.md` contains the release version.
- `.readthedocs.yaml` uses the intended MkDocs config and search ranking.
- No docs include secret values, `.env` contents, database rows, raw prompts, or telemetry payloads.

## Version alignment

Release checks verify that:

- `package.json` version matches `src/forge/version.ts`
- Generated artifact headers use the same generator version

Run locally:

```bash
bun test tests/release/version-alignment.test.ts
```
