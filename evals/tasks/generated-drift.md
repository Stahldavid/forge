# Eval: Generated Drift

## Objective

Recover from source edits while keeping generated artifacts derived, not hand-authored.

## Fixture

```bash
npm create forgeos-app@alpha drift-eval -- --template minimal-web --no-git
cd drift-eval
npm run generate
```

Before giving the task to the agent, make a source change that requires regeneration.

## Agent prompt

```txt
Use ForgeOS to detect generated drift, regenerate the app contract, verify the app, and produce a handoff.
Do not hand-edit generated files.
```

## Required behavior

- Runs `forge changed --json`, `forge dev --once --json`, or `forge generate --check --json`.
- Runs `forge generate` to refresh derived artifacts.
- Separates authored changes from generated/operational changes in the handoff.
- Runs `forge check` and verification.

## Failure conditions

- Manually edits `src/forge/_generated/**`, `forge.lock`, or generated adapter files.
- Commits or reports generated-only work as authored value.
- Skips generated drift verification.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Drift detected, regenerated, verified, and clearly separated in handoff. |
| 1 | Drift fixed but handoff or test evidence is incomplete. |
| 0 | Generated files are hand-edited or stale. |
