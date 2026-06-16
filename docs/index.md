# ForgeOS

ForgeOS is an agent-native application framework and compiler. It gives AI coding agents and humans a generated contract for the app they are editing: commands, queries, liveQueries, policies, data, secrets, frontend routes, runtime rules, AI tools, and the commands needed to verify a change.

The current npm release line is **`forgeos@alpha`**. See [Changelog](changelog.md) for version history.

## Quickstart

Recommended public app creation:

```bash
npm create forge-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

Install ForgeOS globally:

```bash
npm install -g forgeos@alpha
forge --version
```

Or run once with `npx`:

```bash
npx forgeos@alpha --help
```

Equivalent explicit ForgeOS command:

```bash
npx forgeos@alpha new notes-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
cd notes-app
npm run dev
```

ForgeOS is useful when you want a backend/runtime that is explicit, inspectable, and safe for code agents to operate without a mandatory dashboard. See [Why ForgeOS](why-forgeos.md) for the full thesis.

## Agent-first loop

```bash
forge do inspect --json
forge dev --once --json
forge inspect all --json
forge verify --standard
```

See [Agent Workflow](agent-workflow.md).

## The 30-second agent workflow

An agent can enter a ForgeOS project and ask the app for its own operating context:

```bash
forge do inspect --json
forge inspect all --json
forge inspect capabilities --json
forge inspect agent-tools --json
```

The response gives the agent commands, queries, liveQueries, actions, workflows, policies, tables, frontend routes, package rules, AI tools, generated drift, risks, and the next command to run.

When a feature needs an external package, ForgeOS keeps the same contract-first model. Use `forge add` for known integrations and `forge deps api` when an agent needs exact SDK signatures before writing code.

## What ForgeOS Generates

- `AGENTS.md` for agent and human workflow instructions.
- `src/forge/_generated/agentContract.json` for machine-readable project context.
- `src/forge/_generated/agentTools.json` for AI-callable tools and auto-tools.
- `src/forge/_generated/appMap.md` for a human architecture map.
- `src/forge/_generated/packageGraph.json` plus `dependencyApis` in `agentContract.json` for package/API evidence.
- Runtime guards for commands, queries, liveQueries, actions, workflows, policies, packages, secrets, auth, AI placement, and frontend wiring.

## Core Loop

```bash
forge dev
forge dev --once --json
forge inspect all --json
forge verify --standard
```

Use `forge dev` for the local loop and `forge dev --once --json` when an agent needs a deterministic diagnostic snapshot.

## Documentation Map

### Start here

| Topic | Page |
|-------|------|
| Install and first app | [Getting Started](getting-started.md) |
| Full first app walkthrough | [First App Tutorial](tutorial-first-app.md) |
| Why ForgeOS exists | [Why ForgeOS](why-forgeos.md) |
| Public capability map | [Capabilities](capabilities.md) |
| Compiler/runtime architecture | [Architecture](architecture.md) |
| Template file trees | [Examples](examples.md) |
| Templates (`minimal-web`, `b2b-support-web`) | [Templates](templates.md) |
| Agent intent router (`forge do`) | [Agent Workflow](agent-workflow.md) |
| Agent issue-to-handoff loop | [Agent Playbook](agent-playbook.md) |
| Build a feature with an agent | [Build a Feature with an Agent](agent-feature-tutorial.md) |
| Local control panel | [Dev Loop](dev-loop.md) |
| CLI workflows | [CLI](cli.md) |
| Full CLI list | [CLI Reference](cli-reference.md) |

### Core concepts

| Topic | Page |
|-------|------|
| Commands vs actions vs workflows | [Runtime Model](runtime-model.md) |
| Runtime flow by example | [Runtime by Example](runtime-by-example.md) |
| React hooks, liveQuery, capability map | [Frontend](frontend.md) |
| Frontend/backend wiring guide | [Frontend Integration Guide](frontend-integration-guide.md) |
| Simple generation, agents, tools | [AI](ai.md) |
| Native AI tools and agent loop | [AI Agents](ai-agents.md) |
| Auth, policies, secrets, RLS, DB | [Security and Data](security-and-data.md) |

### Build and integrate

| Topic | Page |
|-------|------|
| `forge make`, feature blueprints | [Authoring](authoring.md) |
| Install integrations safely with generated adapters | [forge add](forge-add.md) |
| Inspect SDK APIs before coding | [CLI - Dependency API oracle](cli.md#dependency-api-oracle-for-agents-and-upgrades) |
| Package graph, runtime compatibility, API evidence | [Package Intelligence](package-intelligence.md) |
| Integration recipes | [Recipes](recipes.md) |
| Payment flows and webhooks | [Payments](payments.md) |
| AST-aware refactors | [Codemods](codemods.md) |

### Agents and quality

| Topic | Page |
|-------|------|
| Agent-readable contract | [Agent Contract](agent-contract.md) |
| Impact tests, repair, verify gates | [Testing and Repair](testing-and-repair.md) |
| Guard violations, verify, repair | [Troubleshooting](troubleshooting.md) |
| External app validation | [Field Testing](field-testing.md) |
| Production maturity by area | [Production Readiness](production-readiness.md) |
| Public security boundaries and threats | [Threat Model](threat-model.md) |

### Ship

| Topic | Page |
|-------|------|
| Self-host compose and checks | [Self-Host](self-host.md) |
| Production-like operations and diagnostics | [Operations](operations.md) |
| npm release and publishing | [Release](release.md) |
| Version history | [Changelog](changelog.md) |
