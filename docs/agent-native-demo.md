# Agent-Native Demo

The main ForgeOS demo should show a product experience built around external code agents.

The user does not type a prompt into the demo app and wait for a hidden in-browser agent. Instead, the user creates or opens a ForgeOS app, chooses an external coding agent, and watches ForgeOS provide the context and evidence that make that agent effective.

## Demo Story

1. A user opens a ForgeOS app.
2. The workroom shows the app state from `forge status`, `forge changed`, and `forge dev --once`.
3. The user chooses Codex, Claude Code, or Cursor.
4. ForgeOS shows the exact setup command and adapter state.
5. The external agent edits the project in its own tool.
6. Hooks and MCP feed Agent Memory.
7. DeltaDB and Semantic Timeline connect file edits, commands, checks, and proofs.
8. The workroom shows whether the change is ready for handoff or commit.

## What The Demo Must Not Do

- It must not pretend the browser runs Codex, Claude Code, or Cursor.
- It must not present ForgeOS as a feature tour.
- It must not make DeltaDB, Agent Memory, or MCP the headline.
- It must not create fake internal tasks for Codex or Claude Code.

Those systems are the evidence layer. The product story is: external agents can work on this app safely because ForgeOS gives them context and verification.

## Workroom Layout

| Area | Purpose |
|------|---------|
| Project rail | App, branch, changed files, generated freshness, safe-to-edit state |
| Agent lane | Read-only transcript of the external agent session and launch/setup commands |
| App preview | Local preview of the app being changed, similar to Chef/Lovable, but without pretending the browser is the coding agent |
| Source focus | Authored files, generated files, review order, and current diff focus |
| Evidence stream | Hook events, MCP reads, timeline events, checks, proofs, handoff |
| Verification gate | `generate --check`, `check`, impact tests, `verify --standard`, handoff readiness |

The app preview is important. It gives the user the same fast visual feedback they expect from modern AI app builders. The difference is where the intelligence lives: Codex, Claude Code, or Cursor edits the project externally, while ForgeOS observes, verifies, and explains the work.

## Demo Assets

The reproducible browser recording lives in `marketing/demo/playwright-demo.html`.

Regenerate assets with:

```powershell
powershell -ExecutionPolicy Bypass -File marketing/demo/record-playwright-demo.ps1
```

The page is intentionally static and deterministic so release posts can be reproduced. It uses real ForgeOS command names and a curated scenario, but it does not claim to execute an external agent from the browser.
