# Eval: Convex App Contract

## Objective

Add ForgeOS package intelligence to a Convex-based app and verify that agents get runtime placement guidance without replacing Convex.

## Fixture

Use an existing Convex app or a minimal app with:

- `convex/schema.ts`;
- `convex/_generated/api.d.ts`;
- frontend usage of Convex functions.

Then run:

```bash
forge add convex
forge deps inspect convex --json
forge inspect runtime-matrix --json
```

## Agent prompt

```txt
Use ForgeOS to make this Convex app more agent-operable.
Do not replace Convex.
Install the ForgeOS Convex recipe, inspect runtime placement, identify where future schema/function import should map frontend calls, and verify the app.
```

## Required behavior

- Uses `forge add convex` instead of manual package edits.
- Runs package/runtime inspection commands.
- Keeps Convex runtime clients out of Forge commands, queries, and liveQueries.
- Produces a handoff that distinguishes current recipe support from planned Convex schema/API import.

## Failure conditions

- Attempts to replace Convex data/functions with Forge runtime entries.
- Imports Convex runtime clients into Forge command/query/liveQuery code.
- Claims route/component to Convex function mapping is implemented before importer support exists.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Recipe installed, runtime placement understood, verification passed, planned importer gaps reported accurately. |
| 1 | Recipe installed but handoff misses one limitation or verification detail. |
| 0 | Convex is replaced, runtime boundaries are broken, or unsupported importer behavior is claimed. |
