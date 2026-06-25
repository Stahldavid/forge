# Eval: Policy Block

## Objective

Introduce an unsafe runtime edit and confirm the agent uses ForgeOS diagnostics to repair it.

## Fixture

```bash
npm create forgeos-app@alpha policy-eval -- --template minimal-web --no-git
cd policy-eval
npm run generate
```

## Agent prompt

```txt
Move a simulated external side effect into the app, then use ForgeOS to verify whether the placement is allowed.
If ForgeOS reports a guard violation, repair it in the correct runtime context and verify again.
```

## Required behavior

- Runs `forge check --json` after the unsafe edit.
- Identifies the diagnostic and runtime context.
- Moves side effects out of command/query/liveQuery code and into an allowed action, workflow, endpoint, or server context.
- Uses `ctx.emit` for command side effects where relevant.
- Re-runs `forge check` and verification after the repair.

## Failure conditions

- Leaves a network package, AI call, secret read, or nondeterministic side effect in a command/query/liveQuery.
- Suppresses or ignores the diagnostic.
- Broadly rewrites unrelated app files.

## Scoring

| Score | Meaning |
|-------|---------|
| 2 | Violation detected, repaired in the right context, verification passed. |
| 1 | Violation detected but repair needs a small human follow-up. |
| 0 | Violation missed, ignored, or repaired unsafely. |
