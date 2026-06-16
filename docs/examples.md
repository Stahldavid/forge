# Examples

ForgeOS examples show how a generated app is structured and which capabilities each template demonstrates.

## Minimal web app

Create it:

```bash
npm create forgeos-app@alpha notes-app -- --template minimal-web
cd notes-app
npm run dev
```

Initial source tree:

```txt
notes-app/
  AGENTS.md
  forge.config.ts
  package.json
  src/
    actions/
      logNoteCreated.ts
    commands/
      createNote.ts
    forge/
      schema.ts
    policies.ts
    queries/
      listNotes.ts
      liveNotes.ts
  web/
    index.html
    package.json
    src/
      App.tsx
      lib/forge.ts
      main.tsx
      styles.css
```

Capabilities:

| Capability | Where to look |
|------------|---------------|
| Command | `src/commands/createNote.ts` |
| Query | `src/queries/listNotes.ts` |
| LiveQuery | `src/queries/liveNotes.ts` |
| Action | `src/actions/logNoteCreated.ts` |
| Schema | `src/forge/schema.ts` |
| Policy | `src/policies.ts` |
| React bridge | `web/src/lib/forge.ts` |
| UI | `web/src/App.tsx` |

After generation:

```txt
src/forge/_generated/
  agentContract.json
  appMap.md
  frontendGraph.json
  capabilityMap.json
  runtimeRules.md
  operationPlaybooks.md
```

Use this template to learn the full local loop without extra integrations.

## B2B support web app

Create it:

```bash
npm create forgeos-app@alpha support-app -- --template b2b-support-web
cd support-app
npm run dev
```

Initial source tree:

```txt
support-app/
  AGENTS.md
  forge.config.ts
  package.json
  src/
    actions/
      captureTicketCreated.ts
    commands/
      closeTicket.ts
      createTicket.ts
      manageBilling.ts
    forge/
      schema.ts
    policies.ts
    queries/
      getTicket.ts
      listTickets.ts
      liveTickets.ts
    workflows/
      triageTicketWorkflow.ts
  web/
    app/
      layout.tsx
      page.tsx
      providers.tsx
      tickets/page.tsx
    components/
      CreateTicketForm.tsx
      PolicyDeniedDemo.tsx
      TicketList.tsx
      TraceDetails.tsx
      TriageStatus.tsx
    lib/
      forge.ts
```

Capabilities:

| Capability | Demonstrated by |
|------------|-----------------|
| Transactional command | `createTicket`, `closeTicket` |
| Policy denial | `manageBilling` demo path |
| Query and liveQuery | ticket list and live ticket updates |
| Action | ticket-created event capture |
| Workflow | ticket triage workflow |
| Frontend capability map | `/tickets` route and components |
| Trace/debug surface | trace display components |

Use this template to evaluate a realistic full-stack app shape.

## Public proof app

The repository also includes a source-only proof app:

```bash
cd examples/showcase-forge-app
npm install
npm run generate
npm run proof:inspect
npm run proof:dev
npm run proof:capabilities
npm run proof:verify
```

Read:

```txt
examples/showcase-forge-app/README.md
examples/showcase-forge-app/PUBLIC_PROOF.md
```

This app demonstrates the full ForgeOS thesis in one place:

- tenant-scoped data and policies;
- transactional commands;
- queries and liveQueries;
- outbox action after commit;
- workflow with mock AI triage;
- generated React hooks;
- frontend capability map;
- agent contract;
- policy denial surfaced in the UI;
- standard verification loop.

Use it when evaluating whether ForgeOS is useful for AI coding agents, not just whether it can scaffold a starter app.

## Capability inspection

Run these commands in either app:

```bash
npm run forge -- inspect all --json
npm run forge -- inspect frontend --json
npm run forge -- inspect capabilities --json
npm run forge -- agent print-context --json
```

The outputs prove what the app contains. They are more reliable than reading the file tree alone because they include generated state, diagnostics, policies, runtime rules, frontend wiring, and package compatibility.

## Common app changes

| Goal | Start with |
|------|------------|
| Add a resource with UI | `forge make resource <name> --fields ... --with-ui --dry-run --json` |
| Add an integration | `forge add <alias> --dry-run --json` |
| Rename a command | `forge refactor rename command <old> <new> --dry-run --json` |
| Rename a field | `forge refactor rename field table.old table.new --dry-run --json` |
| Add an AI chat route | `forge make ai-chat <name> --dry-run --json` |
| Fix a failing check | `forge do fix --json` |
| Verify a focused edit | `forge verify --changed` |

## What to commit

For app repositories, commit source files and project configuration. Generated apps may ignore noisy generated artifacts:

```txt
src/forge/_generated/**
forge.lock
.forge/test-plans/**
.forge/repairs/**
```

Before handoff, regenerate and check:

```bash
npm run generate
npm run forge -- check --json
npm run forge -- verify --standard
```

## Related pages

- [First App Tutorial](tutorial-first-app.md)
- [Templates](templates.md)
- [Frontend](frontend.md)
- [Agent Contract](agent-contract.md)
