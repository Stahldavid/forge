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

ForgeOS is useful when you want a backend/runtime that is explicit, inspectable, and safe for code agents to operate without a mandatory dashboard.

## Agent-first loop

```bash
forge do inspect --json
forge dev --once --json
forge inspect all --json
forge verify --standard
```

See [Agent Workflow](agent-workflow.md).

## What ForgeOS Generates

- `AGENTS.md` for agent and human workflow instructions.
- `src/forge/_generated/agentContract.json` for machine-readable project context.
- `src/forge/_generated/agentTools.json` for AI-callable tools and auto-tools.
- `src/forge/_generated/appMap.md` for a human architecture map.
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
| Why ForgeOS exists | [Why ForgeOS](why-forgeos.md) |
| Templates (`minimal-web`, `b2b-support-web`) | [Templates](templates.md) |
| Agent intent router (`forge do`) | [Agent Workflow](agent-workflow.md) |
| CLI reference | [CLI](cli.md) |

### Core concepts

| Topic | Page |
|-------|------|
| Commands vs actions vs workflows | [Runtime Model](runtime-model.md) |
| React hooks, liveQuery, capability map | [Frontend](frontend.md) |
| Simple generation, agents, tools | [AI](ai.md) |
| Auth, policies, secrets, RLS, DB | [Security and Data](security-and-data.md) |

### Build and integrate

| Topic | Page |
|-------|------|
| `forge make`, feature blueprints | [Authoring](authoring.md) |
| Install packages safely | [forge add](forge-add.md) |
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

### Ship

| Topic | Page |
|-------|------|
| Self-host compose and checks | [Self-Host](self-host.md) |
| npm release and publishing | [Release](release.md) |
| Version history | [Changelog](changelog.md) |
