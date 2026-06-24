# Getting Started

ForgeOS requires Node.js `22.14` or newer.

This page gets you from zero to a running Forge backend and web app. For the longer walkthrough, see [First App Tutorial](tutorial-first-app.md).

## Create an app

Recommended public quickstart:

```bash
npm create forgeos-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

`npm create forgeos-app@alpha` creates a new app without installing ForgeOS globally. It is the best first command for new users. During alpha, use the `@alpha` tag explicitly; `latest` is not the active release channel and may lag behind alpha while a prerelease hardens.

The generated app contains:

- a Forge backend under `src/`;
- a small web UI under `web/`;
- `AGENTS.md` with agent workflow instructions;
- package scripts that call the local Forge CLI.

## Open the right URL

`npm run dev` prints two kinds of URLs:

| URL | Purpose |
|-----|---------|
| Web URL | The app you open in the browser. |
| API URL | The Forge JSON runtime used by hooks, commands, queries, and liveQuery. |

Open the web URL for the user-facing app. The API URL returns JSON responses and may return `unknown route` at `/`; that does not mean the app is broken.

## Install options

Install globally only if you want the `forge` command available everywhere:

```bash
npm install -g forgeos@alpha
forge --version
```

Run once without global install:

```bash
npx forgeos@alpha --help
```

In generated apps, use the installed or package-script CLI shown by that app:

```bash
forge status --json
npm run forge -- dev --once --json
```

If you are maintaining the ForgeOS framework checkout itself, run the source-tree entrypoint instead:

```bash
node bin/forge.mjs status --json
node bin/forge.mjs verify framework
```

Do not ask app users to run framework verification. `forge verify` is app-scoped; `verify framework` is only for this repository.

Use the lower-level command when you need explicit flags:

```bash
forge new notes-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
```

## Templates

| Template | Best for |
|----------|----------|
| `minimal-web` | Learning Forge, small prototypes |
| `agent-workroom` | Showing ForgeOS as an external-agent development cockpit |
| `b2b-support-web` | Tickets, policies, Stripe, AI triage, liveQuery showcase |

See [Templates](templates.md) and [Examples](examples.md) for file trees, package aliasing, and generated-app git hygiene.

## First checks

Run these before editing a generated app:

```bash
npm run forge -- do inspect --json
npm run forge -- dev --once --json
npm run forge -- inspect all --json
npm run forge -- check --json
```

These commands tell you what exists, what is stale, which routes call which runtime entries, and which command to run next.

If the first feature needs a provider SDK or integration, do not start with `npm install`. Start with Forge's integration workflow:

```bash
npm run forge -- add stripe --dry-run --json
npm run forge -- add stripe --json
npm run forge -- deps api stripe checkout.sessions.create --json
```

`forge add` applies integration recipes, registers secret names, emits adapters, and updates runtime/package metadata. `forge deps api` gives an agent exact SDK signatures and placement hints before it writes code.

Run these before handing off a change:

```bash
npm run generate
npm run forge -- verify --standard
```

Use `verify --strict` for release or final handoff gates.

## What to read first

Generated apps include files for humans and AI agents:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/appMap.md
src/forge/_generated/runtimeRules.md
src/forge/_generated/frontendGraph.json
src/forge/_generated/capabilityMap.json
```

Read them. Do not edit them. Change source files, then run:

```bash
npm run generate
```

## Next steps

| Topic | Page |
|-------|------|
| End-to-end first app | [First App Tutorial](tutorial-first-app.md) |
| Runtime flow by example | [Runtime by Example](runtime-by-example.md) |
| Build a feature with an agent | [Build a Feature with an Agent](agent-feature-tutorial.md) |
| Agent issue-to-handoff loop | [Agent Playbook](agent-playbook.md) |
| Agent-first workflow (`forge do`) | [Agent Workflow](agent-workflow.md) |
| Local dev diagnostics | [Dev Loop](dev-loop.md) |
| Architecture and generated files | [Architecture](architecture.md) |
| Capability overview | [Capabilities](capabilities.md) |
| Template file trees | [Examples](examples.md) |
| Runtime rules (commands vs workflows) | [Runtime Model](runtime-model.md) |
| Frontend hooks and liveQuery | [Frontend](frontend.md) |
| Frontend/backend wiring | [Frontend Integration Guide](frontend-integration-guide.md) |
| AI generation and agents | [AI](ai.md) |
| Native AI tools and agent loop | [AI Agents](ai-agents.md) |
| Scaffold resources and blueprints | [Authoring](authoring.md) |
| Auth, policies, secrets, RLS | [Security and Data](security-and-data.md) |
| Add Stripe, PostHog, Sentry, Zod, or AI SDK | [forge add](forge-add.md) |
| Package graph and API oracle | [Package Intelligence](package-intelligence.md) |
| Inspect package APIs for agents | [CLI - Dependency API oracle](cli.md#dependency-api-oracle-for-agents-and-upgrades) |
| Fix guard violations | [Troubleshooting](troubleshooting.md) |
| Version history | [Changelog](changelog.md) |
