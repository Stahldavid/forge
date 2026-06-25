# Agent-Native Demos

These demos are short proof loops for the public ForgeOS thesis:

> Convince a third party that the app is agent-readable, agent-changeable, and agent-verifiable.

Each demo should fit in a short recording or live walkthrough. Do not show every command ForgeOS has. Show one useful loop and one safety boundary.

## Demo 1: Agent understands app

Goal: show that a coding agent can understand a ForgeOS app without scanning every source file.

```bash
npm create forgeos-app@alpha notes-demo -- --template minimal-web --no-git
cd notes-demo
npm run generate
npm run forge -- do inspect --json
npm run forge -- inspect all --json
npm run forge -- inspect capabilities --json
```

Show:

- commands, queries, liveQueries, and frontend routes in the generated contract;
- route/component to backend bindings in the capability map;
- runtime rules and generated-file boundaries in `AGENTS.md`;
- the next verification command recommended by ForgeOS.

Success signal:

The agent can answer which UI route creates a note, which liveQuery updates the page, and which generated files it must not edit.

## Demo 2: Agent makes a safe change

Goal: show a small feature change with an explicit verification loop.

Example task:

```txt
Add a priority field to notes, show it in the UI, and verify the changed app.
```

Suggested flow:

```bash
npm run forge -- do "add note priority" --json
npm run forge -- changed --json
npm run forge -- generate
npm run forge -- check
npm run forge -- test plan --changed --json
npm run forge -- verify --standard
npm run forge -- handoff --json
```

Show:

- files the agent chose to edit;
- generated drift and capability-map updates after `forge generate`;
- selected tests instead of an unbounded test guess;
- final handoff with changed files and remaining risks.

Success signal:

The change is visible in source, reflected in generated contracts, and verified through the ForgeOS test gate.

## Demo 3: Agent blocked by policy

Goal: show that ForgeOS is valuable when an agent does the wrong thing.

Example unsafe edit:

```txt
Call an external network SDK directly from a command, or read a runtime secret through process.env in Forge runtime code.
```

Expected flow:

```bash
npm run forge -- check --json
npm run forge -- repair diagnose --from-last-test-run --json
```

Show:

- the diagnostic code;
- file and runtime context;
- fix hint;
- the correct placement, such as moving side effects to an action or using `ctx.secrets`.

Success signal:

The agent receives a local, specific failure before the bad boundary becomes production behavior.

## Recording checklist

- Start with the app, not a marketing slide.
- Keep the command transcript visible.
- Show generated contract snippets only when they answer an agent question.
- End every demo with `forge handoff --json` or `forge verify --standard`.
- Mention which surfaces are alpha and which are experimental.

## Related pages

- [AI Coding with ForgeOS](ai-coding-with-forgeos.md)
- [Stable Alpha Surface](stable-alpha.md)
- [Testing and Repair](testing-and-repair.md)
- [Troubleshooting](troubleshooting.md)
