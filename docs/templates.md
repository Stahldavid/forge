# Templates

ForgeOS ships **source-only templates** for creating new apps. Generated artifacts (`_generated/`, `forge.lock`) are recreated by `forge generate` — templates stay clean in git.

## Create an app

Recommended:

```bash
npm create forge-app@alpha my-app -- --template minimal-web
cd my-app
npm run dev
```

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
| `b2b-support-web` | Forge + Next-style `web/` | Tickets, policies, Stripe hooks, AI triage workflow, liveQuery | Full-stack showcase, B2B support apps |

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

After creation, see:

- [Getting Started](getting-started.md) — first commands
- [First App Tutorial](tutorial-first-app.md) — full first app walkthrough
- [Examples](examples.md) — template file trees
- [Frontend](frontend.md) — hooks and liveQuery
- [Authoring](authoring.md) — add resources
- [Field Testing](field-testing.md) — validate external installs

## Related pages

- [Release](release.md) — publishing `forgeos` and `create-forge-app`
- [CLI](cli.md) — `forge new` flags
