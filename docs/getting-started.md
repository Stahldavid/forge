# Getting Started

ForgeOS requires Node.js `22.14` or newer.

## Install

```bash
npm install -g forgeos@alpha
forge --version
```

If you do not want a global install, use `npx`:

```bash
npx forgeos@alpha --help
```

## Create a Minimal App

Recommended public quickstart:

```bash
npm create forge-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

Equivalent explicit ForgeOS command:

```bash
forge new notes-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
cd notes-app
npm run dev
```

The generated app contains a Forge backend and a small web UI. `forge dev` starts the API runtime and the web app together when the template has a `web/` directory.

### Templates

| Template | Best for |
|----------|----------|
| `minimal-web` | Learning Forge, small prototypes |
| `b2b-support-web` | Tickets, Stripe, AI triage, liveQuery showcase |

See [Templates](templates.md) for `--forge-spec`, npm alias `"forge": "npm:forgeos@alpha"`, and gitignore conventions.

## Agent-Friendly First Checks

Run these before editing a generated app:

```bash
forge do inspect --json
npm run forge -- dev --once --json
npm run forge -- inspect all --json
npm run forge -- check --json
```

Run these before handing off a change:

```bash
npm run generate
npm run forge -- verify --standard
```

Use `verify --strict` for release or final handoff gates.

See [Agent Workflow](agent-workflow.md) and [Testing and Repair](testing-and-repair.md).

## Next steps

| Topic | Page |
|-------|------|
| Agent-first workflow (`forge do`) | [Agent Workflow](agent-workflow.md) |
| Runtime rules (commands vs workflows) | [Runtime Model](runtime-model.md) |
| Frontend hooks and liveQuery | [Frontend](frontend.md) |
| AI generation and agents | [AI](ai.md) |
| Scaffold resources and blueprints | [Authoring](authoring.md) |
| Auth, policies, secrets, RLS | [Security and Data](security-and-data.md) |
| Add Stripe, PostHog, or AI SDK | [forge add](forge-add.md) |
| Fix guard violations | [Troubleshooting](troubleshooting.md) |
| Version history | [Changelog](changelog.md) |
