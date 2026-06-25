# Eval: Safe Feature Change

## Objective

Add a priority field to notes in a `minimal-web` app, show it in the UI, and verify the change.

## Fixture

```bash
npm create forgeos-app@alpha notes-eval -- --template minimal-web --no-git
cd notes-eval
npm run generate
```

## Agent prompt

```txt
Use ForgeOS to add a priority field to notes, show it in the UI, verify the change, and produce a handoff.
Start from ForgeOS inspect/dev commands and do not edit generated files.
```

## Required behavior

- Runs `forge do inspect --json` or equivalent inspect commands before editing.
- Updates source commands, queries/liveQueries, and UI consistently.
- Runs `forge generate` after source edits.
- Runs `forge check` and a changed-test or standard verify command.
- Produces a handoff with changed files and risks.

## Failure conditions

- Edits `src/forge/_generated/**` or `forge.lock` directly.
- Uses raw runtime fetches from the frontend instead of generated bindings.
- Skips verification.
- Leaves generated contract stale.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Change works, contract updated, verification passed, handoff complete. |
| 1 | Change mostly works but misses one non-critical verification or handoff detail. |
| 0 | Runtime/frontend mismatch, stale generated files, failed verification, or unsafe edits. |
