# CLI

ForgeOS centers day-to-day work around a small command loop:

```bash
forge do inspect --json
forge dev
forge dev --once --json
forge check --json
forge verify --standard
```

Use this page for common workflows. Use [CLI Reference](cli-reference.md) when you need the full command list.

Prefer **[Agent Workflow (`forge do`)](agent-workflow.md)** when you know the goal but not the exact command.

## Create an App

```bash
npm create forge-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

Lower-level equivalent:

```bash
forge new notes-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
```

See [Getting Started](getting-started.md) and [Templates](templates.md).

## Agent workflow (`forge do`)

```bash
forge do inspect --json
forge do "add stripe checkout" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

See [Agent Workflow](agent-workflow.md).

## Local Development

```bash
forge dev
forge dev --once --json
forge dev --mock-ai
```

`forge dev` runs the local backend, worker, checks, and web app when present. `forge dev --once --json` performs a single diagnostic pass and exits. Use `--mock-ai` to avoid real provider calls during local agent or AI testing.

When a web app is present, `forge dev` also exposes agent endpoints documented in [AI](ai.md):

- `POST /ai/agents/run` — JSON agent runs for automation
- `POST /ai/agents/chat` — AI SDK UIMessage streaming for chat UIs

See [Frontend](frontend.md) for hooks, capability map, and liveQuery.

## Introspection

```bash
forge inspect all --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect ai --json
forge inspect agent-tools --json
forge inspect framework --json
forge doctor
forge doctor windows --json
```

### Common `forge inspect` targets

| Target | Shows |
|--------|-------|
| `all` | Aggregated project snapshot |
| `app` | Commands, queries, actions, workflows |
| `data` | Schema, tables, tenant scope |
| `frontend` | Routes, components, bridge files |
| `capabilities` | UI ↔ runtime bindings |
| `runtime-matrix` | Package context compatibility |
| `policies` | RBAC registry |
| `secrets` | Required secret names |
| `client` | Generated client manifest |
| `ai` | Providers, generations, placement |
| `agent-tools` | Explicit + auto tools |
| `framework` | ForgeOS CLI/modules (in framework repo) |

Use these when an agent needs to understand the project before changing it.

## Generation and Verification

```bash
forge generate
forge generate --check
forge check --json
forge verify --standard
forge verify --strict
```

### Verification

| Command | Runs |
|---------|------|
| `forge verify --smoke` | Generated drift, Forge checks, typecheck (fast) |
| `forge verify --standard` | Smoke + impact-selected tests (normal dev gate) |
| `forge verify --strict` | Full test script + lint (handoff / CI) |
| `forge verify --changed` | Checks/tests for current diff only |

```bash
forge verify --standard --script-timeout-ms 120000 --json
forge do verify --json
```

See [Testing and Repair](testing-and-repair.md).

## Integrations

```bash
forge add stripe --dry-run --json
forge add stripe
forge add ai
forge inspect runtime-matrix --json
forge inspect secrets --json
```

See [forge add](forge-add.md), [Recipes](recipes.md), and [Payments](payments.md).

## Dependency API (for agents and upgrades)

After `forge add` or `forge generate`, inspect installed package APIs without reading all of `node_modules`:

```bash
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
forge deps outdated --json
forge deps upgrade-plan stripe --to latest
forge deps upgrade-apply .forge/upgrades/<plan>.json
```

Use `forge deps api` when an agent needs signatures, JSDoc, and examples for a specific SDK symbol. Summaries also appear in `agentContract.json` under `dependencyApis`.

See [forge add — Dependency API for agents](forge-add.md).

## Security and data

```bash
forge auth check --json
forge policy simulate tickets.create --role member --json
forge secrets list --json
forge env check --json
forge db diff --json
forge db migrate --db pglite
forge rls check --json
```

See [Security and Data](security-and-data.md).

## AI

```bash
forge add ai
forge ai providers --json
forge ai models --json
forge ai check --json
forge ai tools --json
forge ai agents --json
forge ai test --provider openai --model gpt-4o-mini --prompt "hello" --mock
forge ai trace <traceId> --json
forge make ai-chat support --dry-run --json
```

| Subcommand | Purpose |
|------------|---------|
| `providers` | List configured AI providers from `aiRegistry.json` |
| `models` | List known models and cost metadata |
| `check` | Verify required provider secrets are configured |
| `test` | Run a single generation (`--mock` avoids network) |
| `tools` | List explicit and auto-generated agent tools |
| `agents` | List declared agent definitions |
| `trace` | Inspect a recorded agent/AI run by trace id |

See [AI](ai.md) for runtime placement, simple generation, agents, and tool approval.

## Authoring

```bash
forge make list --json
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --yes
forge make ui --framework vite --yes
forge make ai-chat support --yes
forge feature validate .forge/blueprints/example.json --json
forge feature plan .forge/blueprints/example.json
forge feature apply .forge/blueprints/example.json --yes
```

See [Authoring](authoring.md).

## Refactors

```bash
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename field notes.status notes.state --dry-run --json
forge refactor extract-action charge --package stripe --dry-run --json
```

Use `--dry-run --json` for plans that touch schema, policies, or UI wiring. See [Codemods](codemods.md).

## Testing, repair, and review

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge review run --changed --json
forge ui smoke --json
```

See [Testing and Repair](testing-and-repair.md).

## LiveQuery

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

See [Frontend — LiveQuery](frontend.md#livequery).

## Agent contract and adapters

```bash
forge agent-contract check
forge agent print-context --json
forge agent export --target generic
forge agent export --target cursor
forge agent export --target codex
forge agent export --target claude
```

See [Agent Contract](agent-contract.md).

## Self-host

```bash
forge self-host compose
forge self-host check --json
```

See [Self-Host](self-host.md).

## When checks fail

```bash
forge doctor
forge check --json
forge repair diagnose --from-last-test-run --json
```

See [Troubleshooting](troubleshooting.md).
