# Templates

ForgeOS ships **source-only templates** for creating new apps. Generated artifacts (`_generated/`, `forge.lock`) are recreated by `forge generate` — templates stay clean in git.

## Create an app

Recommended:

```bash
npm create forgeos-app@alpha my-app -- --template minimal-web
npm create forgeos-app@alpha . -- --template minimal-web
npm create forgeos-app@alpha my-app -- --template nuxt-web
cd my-app
npm run dev
```

Use `.` from an empty current directory when you already created and entered
the target folder. ForgeOS refuses `.` when the directory contains app files, so
scaffolding does not overwrite existing work.

Expected result:

- Forge starts the API runtime.
- Forge starts the web dev server when `web/` exists.
- The terminal prints the API URL and the web URL.
- The app contains `AGENTS.md` and source files, but may ignore generated files until `forge generate` runs.

Lower-level:

```bash
forge new my-app \
  --template minimal-web \
  --package-manager npm \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --no-git
```

## Available templates

| Template | Stack | Includes | Best for |
|----------|-------|----------|----------|
| `minimal-web` | Forge backend + Vite React `web/` | Basic CRUD patterns, `ForgeProvider`, client bridge | Learning Forge, prototypes |
| `nuxt-web` | Forge backend + Nuxt Vue `web/` | Notes command/liveQuery, client/server Nuxt plugins, `useNotes`, Vue composables, Nitro runtime-config route | Vue/Nuxt apps |
| `agent-workroom` | Forge backend + Vite React observer UI | App preview, terminal-like external-agent signals, generated state, diff focus, check runs, handoff evidence, liveQuery | Demonstrating ForgeOS as an agent-native development environment |
| `vendor-access` | Forge backend + Vite React `web/` | Vendor access approvals, permission-first policies, local WorkOS-like personas, automatic demo seed, liveQuery, WorkOS-ready auth bridge | Field-testing production-shaped multi-tenant auth/workflow apps |
| Nuxt UI shell via `forge make ui --framework nuxt` | Forge backend + Nuxt Vue `web/` | Nuxt plugin, Vue composables, runtime config bridge | Vue/Nuxt apps |
| `b2b-support-web` | Forge + Next-style `web/` | Tickets, policies, Stripe hooks, AI triage workflow, liveQuery | Full-stack showcase, B2B support apps |

Templates with seed commands can be prepared from the CLI while `forge dev` is
running, or automatically seeded during startup:

```bash
forge dev --seed
forge seed status --json
forge seed dev --json
```

List templates from the CLI:

```bash
forge new --help
```

See [Examples](examples.md) for concrete file trees.

## npm package naming

Published npm package: **`forgeos@alpha`**.

Generated apps depend on Forge through an **npm alias** so imports stay stable:

```json
{
  "dependencies": {
    "forge": "npm:forgeos@alpha"
  }
}
```

App code imports:

```typescript
import { command } from "forge/server";
import { useCommand } from "forge/react"; // via local bridge
```

The CLI binary in generated apps is still `forge` (via the aliased package).

## Forge spec options

| Flag | Effect |
|------|--------|
| `--forge-spec "npm:forgeos@alpha"` | Pin to published alpha (external users) |
| `--forge-spec "file:../forge"` | Local monorepo path (framework development) |
| `--local-forge` | Convenience for working inside the Forge repo |

Field tests and release smoke use `--forge-spec` explicitly to prove external install paths.

## Template git hygiene

Template apps often **gitignore**:

```txt
src/forge/_generated/**
forge.lock
.forge/delta/**
.forge/agent/*.ndjson
.forge/agent/*.history
.forge/studio/**
.forge/test-plans/**
.forge/repairs/**
```

After clone or checkout:

```bash
forge generate
forge check --json
```

Without generate, `forge doctor` reports stale or missing artifacts.

## Choose a template

```txt
Need only API + small UI     -> minimal-web
Need Vue/Nuxt starter        -> nuxt-web
Need external-agent demo     -> agent-workroom
Need tickets + billing + AI  -> b2b-support-web
Custom domain                -> minimal-web + forge make resource ...
```

## After creation

Run:

```bash
npm run forge -- dev --once --json
npm run forge -- inspect frontend --json
npm run forge -- inspect capabilities --json
```

These commands verify that the generated frontend, provider, hook bridge, runtime entries, and capability map agree.
For `agent-workroom`, ForgeOS also keeps a template smoke that executes the generated `openWorkroom`, `recordAgentSignal`, `recordCheckRun`, and `liveWorkroom` runtime path against an in-memory database. That test proves the demo is more than a static shell: external-agent evidence, preview status, generated freshness, authored/generated diff focus, and verification results can be recorded and surfaced through liveQuery without launching the browser.

After creation, see:

- [Getting Started](getting-started.md) — first commands
- [First App Tutorial](tutorial-first-app.md) — full first app walkthrough
- [Examples](examples.md) — template file trees
- [Frontend](frontend.md) — hooks and liveQuery
- [Authoring](authoring.md) — add resources
- [Field Testing](field-testing.md) — validate external installs

## Related pages

- [Release](release.md) — publishing `forgeos` and `create-forgeos-app`
- [CLI](cli.md) — `forge new` flags
