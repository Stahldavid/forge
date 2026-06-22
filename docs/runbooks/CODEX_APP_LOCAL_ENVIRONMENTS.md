# Codex App local environments for ForgeOS

This repo already contains ForgeOS-specific Codex agents, hooks, and skills under `.codex/`. Keep those files as the source of Codex integration behavior for this project.

## Worktrees

Use Codex App worktrees for agent threads that may edit code. The repo root is:

```text
C:\Users\David\Documents\forge
```

The `.worktreeinclude` file intentionally copies no ignored local files by default. `.env.local` currently contains `RTD_TOKEN`, which is not needed for normal framework development, tests, or verification.

Only add `.env.local` to `.worktreeinclude` for a specific worktree workflow that truly needs local docs/release credentials, then remove it again.

Do not copy generated runtime directories or local caches into worktrees:

```text
node_modules/
.forge/cache/
.forge/pglite/
.forge/delta/
.forge/local/
.forge/locks/
.forge/test-cache/
.forge/test-runs/
.forge/ui-runs/
.playwright-cli/
site/
site-*/
.venv-rtd/
```

## Local environment: ForgeOS Bun Agent Loop

Use this as the default environment for normal ForgeOS development.

Setup script:

```powershell
bun install --ignore-scripts
bun run forge generate
```

Recommended actions:

```powershell
bun run forge agent print-context --json
bun run forge status --json
bun run forge changed --json
bun run forge do inspect --json
bun run forge dev --once --json
bun run forge check --json
bun run forge verify --standard --script-timeout-ms 120000
bun run forge verify framework
bun run typecheck
bun test --timeout 120000
```

Notes:

- Follow `AGENTS.md` before editing.
- Prefer Forge primitives such as `forge do`, `forge make`, `forge refactor`, `forge repair`, and `forge generate`.
- Do not edit `src/forge/_generated/**` directly.

## Local environment: ForgeOS Node/npm Compatibility

Use this for Node CLI compatibility and npm package smoke checks.

Setup script:

```powershell
npm install --ignore-scripts --package-lock=false
```

Recommended actions:

```powershell
node ./bin/forge.mjs inspect framework --json
node ./bin/forge.mjs inspect capabilities --json
npm run build
npm run release:pack
npm run release:smoke
npm run field:test -- --dry-run --json
```

## Local environment: ForgeOS Security

Use this for local security checks without real provider keys.

Setup script:

```powershell
bun install --ignore-scripts
bun run forge generate
```

Recommended actions:

```powershell
$env:FORGE_MOCK_AI = "1"
$env:AI_GATEWAY_API_KEY = "forge-local-redacted-ai-gateway-key"
$env:ANTHROPIC_API_KEY = "forge-local-redacted-anthropic-key"
$env:OPENAI_API_KEY = "forge-local-redacted-openai-key"
bun run forge generate --check
bun run forge check --json
bun run forge auth check --json
bun run forge secrets check --json
bun run forge ai check --json
node ./bin/forge-bun.mjs test tests/security --timeout 120000
```

Keep Postgres-backed RLS actions manual unless `DATABASE_URL` is intentionally configured.

## Local environment: ForgeOS Docs

Use this for local ReadTheDocs/MkDocs validation.

Setup script:

```powershell
python -m venv .venv-rtd
.\.venv-rtd\Scripts\python -m pip install -r docs\requirements.txt
```

Recommended actions:

```powershell
.\.venv-rtd\Scripts\python -m mkdocs build --strict
```

## Actions to keep manual

Avoid adding these as quick actions unless the current task explicitly targets release/publishing and the external state is confirmed:

```text
npm run changeset
npm run release
npm run release:publish-alpha
npm run release:publish-local-alpha
gh workflow run publish.yml
```

These commands can affect versioning, npm publishing, GitHub Actions release state, or external credentials.
