# First App Tutorial

This tutorial builds a small notes app from a published ForgeOS package. It shows the full loop: create an app, run the API and UI together, inspect the generated contract, change the app, and verify the result.

Time: 15 minutes.

## Prerequisites

- Node.js `22.14` or newer.
- npm `10` or newer.
- A terminal in an empty workspace directory.

Check your versions:

```bash
node --version
npm --version
```

## 1. Create the app

```bash
npm create forge-app@alpha notes-app -- --template minimal-web
cd notes-app
```

The generated app uses the published package through an npm alias:

```json
{
  "dependencies": {
    "forge": "npm:forgeos@alpha"
  }
}
```

App source imports from `forge/*`; npm resolves those imports to `forgeos@alpha`.

## 2. Start development

```bash
npm run dev
```

For the `minimal-web` template, `forge dev` starts:

- the Forge API runtime;
- the local database adapter;
- the outbox worker;
- the web dev server under `web/`;
- frontend/backend wiring diagnostics.

Open the web URL printed by the command. The API URL is for JSON runtime calls. The web URL is the user-facing app.

## 3. Take a deterministic snapshot

In a second terminal, run:

```bash
npm run forge -- dev --once --json
```

The command exits after one diagnostic pass. It reports health, generated drift, API URL, web URL, routes, frontend bindings, and fix hints.

Use it when an AI agent needs a stable project snapshot without keeping a server open.

## 4. Inspect the generated contract

```bash
npm run forge -- inspect all --json
npm run forge -- inspect frontend --json
npm run forge -- inspect capabilities --json
```

The first command aggregates the app graph, data graph, runtime matrix, policies, secrets, AI, client, frontend, deploy data, and diagnostics.

The frontend commands answer these questions:

- Which routes exist?
- Which components call Forge hooks?
- Which runtime entries have UI callers?
- Which UI calls point at missing backend entries?

## 5. Read the generated files

Open these files:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/appMap.md
src/forge/_generated/runtimeRules.md
src/forge/_generated/frontendGraph.json
src/forge/_generated/capabilityMap.json
```

Do not edit generated files. They explain the app to humans and agents. Change source files, then run `forge generate`.

## 6. Plan the first change

Preview a safe field rename before applying any edit:

```bash
npm run forge -- refactor rename field notes.title notes.heading --dry-run --json
```

Read the plan before applying it. For a real app change that adds schema, commands, policies, and UI together, prefer `forge make resource` or a feature blueprint.

Example resource command:

```bash
npm run forge -- make resource task --fields title:text,status:enum(open,done) --with-ui --dry-run --json
```

Apply only after reviewing the generated plan:

```bash
npm run forge -- make resource task --fields title:text,status:enum(open,done) --with-ui --yes
```

## 7. Regenerate and check

```bash
npm run generate
npm run forge -- check --json
```

`forge check` validates runtime placement, package guards, policies, generated artifacts, frontend wiring, and diagnostics.

## 8. Verify the app

```bash
npm run forge -- verify --standard
```

Use `--standard` for normal agent development. Use `--strict` before a release or final handoff:

```bash
npm run forge -- verify --strict
```

If verification fails, route through the repair loop:

```bash
npm run forge -- do fix --json
npm run forge -- repair diagnose --from-last-test-run --json
```

## What changed on disk

A minimal app starts with this shape:

```txt
notes-app/
  AGENTS.md
  forge.config.ts
  package.json
  src/
    actions/
    commands/
    forge/schema.ts
    policies.ts
    queries/
  web/
    src/App.tsx
    src/lib/forge.ts
```

After `forge generate`, ForgeOS recreates generated context:

```txt
src/forge/_generated/
  agentContract.json
  appMap.md
  frontendGraph.json
  capabilityMap.json
  runtimeRules.md
  operationPlaybooks.md
```

Generated apps may ignore those files in git. Recreate them with `forge generate` before checking, testing, or handing the app to another agent.

## Next steps

- [Build a Feature with an Agent](agent-feature-tutorial.md)
- [Architecture](architecture.md)
- [Frontend](frontend.md)
- [Testing and Repair](testing-and-repair.md)
