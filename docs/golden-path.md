# Alpha Golden Path

This is the recommended alpha hardening path for ForgeOS apps and for the ForgeOS framework repo itself.

The goal is not to add more features. The goal is to make the path from "open project" to "verified handoff" boring, repeatable, and agent-friendly.

## 0. Canonical App-To-Production Path

For a new production-shaped app, start with the single golden-path command. It
does not hide the underlying checks; it prints the official ladder and keeps
the next command obvious for humans and coding agents:

```bash
forge golden-path plan --auth workos --target docker --real --production --json
```

To prove the public alpha package, keep the default package source or make it
explicit:

```bash
forge golden-path plan --auth workos --target docker --forge-spec npm:forgeos@alpha --real --production --json
```

Before publishing a release, maintainers can run the same path against this
checkout:

```bash
forge golden-path plan --auth workos --target docker --forge-spec file:/home/codex/work/forge --real --production --json
```

The canonical P0 flow is:

```bash
forge field-test create vendor-access --auth workos --template vendor-access --package-manager npm --forge-spec npm:forgeos@alpha --install --git --json
cd vendor-access
npm run forge -- add auth workos --json
npm run forge -- authmd generate --json
npm run forge -- authmd check --json
npm run forge -- workos doctor --json
npm run forge -- workos seed --file workos-seed.yml --dry-run --json
npm run forge -- workos env --client-id client_... --write --json
npm run forge -- workos setup --real --file workos-seed.yml --json
npm run forge -- auth prove --provider workos --real --client-id client_... --file workos-seed.yml --json
npm run forge -- auth prove --scenario multi-tenant --json
npm run forge -- field-test run --realistic --json
npm run forge -- field-test report --json
npm run forge -- deploy init --target docker --json
cp deploy/.env.production.example deploy/.env.production
npm run forge -- env doctor --target production --json
npm run forge -- deploy readiness --production --json
npm run forge -- deploy check --production --json
npm run forge -- deploy package --target docker
npm run forge -- deploy verify --production --url https://app.example.com --json
```

For an existing app, use:

```bash
forge golden-path status --real --production --json
```

When the AuthKit client id is already known, include it so ForgeOS returns exact
commands instead of placeholders:

```bash
forge golden-path status --real --production --client-id client_... --json
```

It reads current WorkOS posture, field-test evidence, and deploy readiness, then
answers three things:

- can this app publish?
- if not, what exactly blocks it?
- what is the next command?

`summary.blockers` starts with the first blocked stage, such as
`workos-doctor`, `workos-real-seed`, `field-test`, or `deploy`, then includes
the underlying readiness blockers. This is intentional: coding agents should be
able to choose the next command without reading every nested check.

With `--real`, WorkOS auth is not considered complete just because local
adapter files pass `forge workos doctor`. ForgeOS also requires hosted seed
evidence in `.workos-seed-state.json` that matches the current
`workos-seed.yml`. Before that proof, ForgeOS checks that `.env.local` has the
real AuthKit client id, Forge audience, JWKS URI, cookie password, and matching
web public env. If the env is incomplete, `golden-path status` stops at:

```bash
forge workos env --client-id client_... --write --json
```

When WorkOS CLI auth is active but the CLI only reports `hasClientId: true`
without exposing the value, provide the AuthKit client id explicitly:

```bash
forge workos env --client-id client_... --write --json
```

If hosted evidence is missing or stale after env is ready, `golden-path status`
stops at the `auth` stage and points to:

```bash
forge auth prove --provider workos --real --file workos-seed.yml --json
```

`forge auth prove --provider workos --real --client-id client_... --file
workos-seed.yml --json` is the semantic wrapper for the same hosted WorkOS
proof. It prepares `.env.local` and `web/.env.local` with the AuthKit client id
before proving hosted setup, so agents do not need shell-specific env exports or
dashboard clicks. If `forge workos env --client-id ... --write --json` already
ran and the env is complete, the shorter `auth prove --provider workos --real
--file workos-seed.yml --json` form is also valid.

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
When generated artifacts are the only noise, use `forge changed --authored --json` to confirm there are no authored edits before deciding whether the repository should ignore or track those artifacts.

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
