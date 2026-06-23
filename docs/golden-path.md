# Alpha Golden Path

This is the recommended alpha hardening path for ForgeOS apps and for the ForgeOS framework repo itself.

The goal is not to add more features. The goal is to make the path from "open project" to "verified handoff" boring, repeatable, and agent-friendly.

## 1. Start With Orientation

Run the compact commands before opening broad source trees:

```bash
forge status --json
forge changed --json
forge dev --once --json
forge inspect all --brief --json
```

In a generated app, `forge` means the installed/package-script CLI for that app. In the ForgeOS framework checkout, use `node bin/forge.mjs ...` for the same commands and reserve global `forge` for public package smoke tests.

Read:

- `summary.generated`
- `summary.drift`
- `summary.changedFiles`
- `reviewFocus`
- `agentContext.safeToEdit`
- `agentContext.recommendedReadFiles`
- `agentContext.recommendedCommands`

If `forge changed --json` reports generated files, treat them as derived evidence. Review authored changes first.

## 2. Onboard The External Agent

Use the adapter for the agent that will edit the app:

```bash
forge agent onboard --target codex --json
forge agent hooks status --target codex --json
forge agent context --current --json
```

For Claude Code or Cursor:

```bash
forge agent prepare --target claude --json
forge agent prepare --target cursor --json
forge mcp serve
```

ForgeOS should not pretend the browser can run Codex, Claude Code, or Cursor. The user opens the chosen external tool in the project directory. ForgeOS supplies the contract, hooks, memory, MCP tools, and verification commands.

## 3. Keep The Worktree Reviewable

Use small commits or handoffs by concern:

| Concern | Typical files |
|---------|---------------|
| CLI and DX | `src/forge/cli/**`, `src/forge/workspace/**`, CLI tests |
| Agent memory and DeltaDB | `src/forge/agent-memory/**`, `src/forge/delta/**`, H48/H44 tests |
| Docs | `docs/**`, `README.md`, `mkdocs.yml` |
| Demo assets | `marketing/demo/**` |
| Generated artifacts | `AGENTS.md`, `forge.lock`, `src/forge/_generated/**` |

Use:

```bash
forge changed --json
forge handoff --json
forge review run --changed --json
```

The important question is not "how many files changed?" It is "which authored change caused the generated diff?"

## 4. Verify With Impact First

Plan targeted checks:

```bash
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
```

Then run:

```bash
forge generate --check --json
forge check --json
forge verify --standard
```

Use strict verification before release, high-risk merges, or public package publication:

```bash
forge verify --strict
```

Framework maintainers use the explicit framework gate:

```bash
node bin/forge.mjs verify framework
```

## 5. Smoke The Public Path

Before publishing another alpha, prove the package outside the workspace:

```bash
npm create forgeos-app@alpha smoke-app -- --template minimal-web
cd smoke-app
forge generate
forge check
forge dev --once --json
```

For the framework repo, also run the existing field/release scripts when preparing a package:

```bash
npm run field:test -- --dry-run --json
npm run release:pack
npm run release:smoke
```

## 6. Handoff Cleanly

End each hardening pass with:

```bash
forge handoff --json
```

The next agent should see:

- what changed
- what is authored vs generated
- which checks passed
- which checks remain
- what files to read first
- what the next command should be

## Alpha Exit Bar

Do not leave alpha merely because features exist. Leave alpha when this path is consistently calm:

- new app creation works from npm
- generated artifacts stay deterministic
- external agent onboarding works for Codex and at least one other adapter
- hooks and MCP provide useful context without storing sensitive raw payloads
- docs explain external agents first and integrated AI second
- public smoke, field test, standard verify, and release evidence are repeatable
