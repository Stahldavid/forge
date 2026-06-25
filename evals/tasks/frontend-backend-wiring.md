# Eval: Frontend Backend Wiring

## Objective

Repair UI/runtime drift in a generated app without bypassing ForgeOS bindings.

## Fixture

```bash
npm create forgeos-app@alpha wiring-eval -- --template minimal-web --no-git
cd wiring-eval
npm run generate
```

Before giving the task to the agent, replace one generated-hook use in the UI with a direct `/commands/...` or `/queries/...` fetch.

## Agent prompt

```txt
Use ForgeOS to find and repair frontend/backend wiring drift.
Do not bypass generated Forge bindings. Verify the repair and produce a handoff.
```

## Required behavior

- Runs `forge dev --once --json` or `forge inspect frontend --json`.
- Finds the direct runtime fetch diagnostic or capability-map gap.
- Replaces the fetch with `useCommand`, `useQuery`, or `useLiveQuery`.
- Runs `forge generate`, `forge check`, and a changed verification command.

## Failure conditions

- Keeps direct runtime fetches in UI components.
- Changes backend behavior unnecessarily.
- Does not inspect frontend/capability output.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Drift found through ForgeOS, repaired through generated bindings, verification passed. |
| 1 | Repair works but misses one inspection or handoff detail. |
| 0 | Drift remains or is hidden by unrelated rewrites. |
