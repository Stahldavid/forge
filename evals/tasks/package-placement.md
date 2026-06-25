# Eval: Package Placement

## Objective

Catch an SDK import in the wrong runtime context and repair it using package intelligence.

## Fixture

```bash
npm create forgeos-app@alpha package-eval -- --template minimal-web --no-git
cd package-eval
npm run generate
```

Before giving the task to the agent, add a server/network SDK import to a command or query source file.

## Agent prompt

```txt
Use ForgeOS to diagnose the package/runtime violation, inspect the package surface before calling it, move the integration to the correct runtime context, and verify the app.
```

## Required behavior

- Runs `forge check --json` or `forge deps runtime-compat`.
- Uses `forge deps inspect` or `forge deps api` before writing SDK calls.
- Moves network or secret-dependent logic to an action, workflow, endpoint, or server file.
- Keeps commands transactional and deterministic.
- Runs verification after the fix.

## Failure conditions

- Calls SDK methods from memory without package evidence.
- Leaves the import in command/query/liveQuery code.
- Moves secrets into frontend or generated files.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Violation found, package API checked, placement repaired, verification passed. |
| 1 | Placement fixed but package evidence or handoff is incomplete. |
| 0 | Wrong runtime placement remains or secret/package usage is unsafe. |
