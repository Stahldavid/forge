# CLI Reference

This page lists common ForgeOS command groups. Start with [CLI](cli.md) for the recommended workflow. Use this page when you need a specific lower-level command.

## App creation

```bash
npm create forgeos-app@alpha my-app -- --template minimal-web
forge new my-app --template minimal-web --package-manager npm --forge-spec "npm:forgeos@alpha" --install --no-git
```

## Intent router

```bash
forge do inspect --json
forge do "<objective>" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

## Development

```bash
forge dev
forge dev --once --json
forge dev --mock-ai
```

## Generation and checks

```bash
forge generate
forge generate --check
forge check
forge check --json
forge doctor
forge doctor --json
forge doctor windows --json
```

## Inspection

```bash
forge inspect all --json
forge inspect app --json
forge inspect data --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect secrets --json
forge inspect client --json
forge inspect ai --json
forge inspect agent-tools --json
forge inspect framework --json
```

## Verification

```bash
forge verify --smoke
forge verify --standard
forge verify --strict
forge verify --changed
forge verify --standard --script-timeout-ms 120000 --json
```

## Authoring

```bash
forge make list --json
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --dry-run --json
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --yes
forge make ui --framework vite --dry-run --json
forge make ai-chat support --dry-run --json
forge feature validate .forge/blueprints/example.json --json
forge feature plan .forge/blueprints/example.json
forge feature apply .forge/blueprints/example.json --yes
```

## Refactors and codemods

```bash
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename table tickets supportTickets --dry-run --json
forge refactor extract-action chargeCustomer --package stripe --dry-run --json
```

Use dry runs for schema, policy, package, or UI edits.

## Integrations and packages

```bash
forge add stripe --dry-run --json
forge add stripe
forge add ai
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
forge deps outdated --json
forge deps upgrade-plan stripe --to latest
forge deps upgrade-apply .forge/upgrades/<plan>.json
```

## Security and data

```bash
forge auth check --json
forge auth prove --json
forge policy simulate tickets.create --role member --json
forge secrets list --json
forge secrets prove --json
forge env check --json
forge db diff --json
forge db migrate --db pglite
forge rls check --json
forge rls test --db postgres --json
forge rls mutate-test --json
forge security prove --json
forge security prove --db postgres --json
forge security prove --db postgres --full --json
```

## AI

```bash
forge ai providers --json
forge ai models --json
forge ai check --json
forge ai tools --json
forge ai agents --json
forge ai redteam --json
forge ai redteam --model-level --json
forge ai redteam --model-level --live --provider gateway --model openai/gpt-5.4 --json
forge ai test --provider openai --model gpt-4o-mini --prompt "hello" --mock
forge ai trace <traceId> --json
```

## Testing, repair, and review

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge test explain tests/commands/createTicket.test.ts --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
forge review run --changed --json
```

## UI and browser tests

```bash
forge ui smoke --json
forge ui scenario <name> --json
forge ui route <path> --json
forge ui doctor --json
```

## LiveQuery

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

## Agent contract and adapters

```bash
forge agent-contract generate
forge agent-contract check
forge agent-contract print --json
forge agent print-context --json
forge agent export --target generic
forge agent export --target cursor
forge agent export --target codex
forge agent export --target claude
```

## Self-host

```bash
forge self-host compose
forge self-host check --json
```

## Release and field testing

```bash
npm run field:test -- --dry-run --json
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "npm:forgeos@alpha" --install --json
npm run release:pack
npm run release:evidence
npm run release:publish-alpha
```

## Related pages

- [CLI](cli.md)
- [Agent Workflow](agent-workflow.md)
- [Testing and Repair](testing-and-repair.md)
- [Release](release.md)
