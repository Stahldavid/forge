# ForgeOS Agent Evals

These evals measure whether ForgeOS helps coding agents change existing apps safely.

The benchmark target is not generic CRUD creation. The benchmark target is app maintenance under real constraints:

- runtime boundaries;
- frontend/backend wiring;
- package placement;
- secrets and tenant policy;
- generated-file hygiene;
- repair and verification quality;
- handoff quality.

## Running an eval manually

1. Create or reset the fixture app named by the task.
2. Give the task prompt to the agent.
3. Require the agent to start with ForgeOS inspect/dev/check commands.
4. Record every command, diagnostic, edit, verification result, and final handoff.
5. Score the run against the task rubric.

## Task files

| Task | Purpose |
|------|---------|
| `tasks/safe-feature-change.md` | Add a small feature while preserving generated contract and tests. |
| `tasks/policy-block.md` | Confirm an unsafe runtime edit is blocked and repaired correctly. |
| `tasks/frontend-backend-wiring.md` | Repair UI/runtime drift through generated hooks and capability map. |
| `tasks/package-placement.md` | Catch and fix SDK imports in the wrong runtime context. |
| `tasks/generated-drift.md` | Recover from source changes without hand-editing generated files. |
| `tasks/convex-app-contract.md` | Add ForgeOS package intelligence to a Convex app without replacing Convex. |

## Result record

For each run, capture:

- `task`;
- `agent`;
- `model`;
- `forgeosVersion`;
- `startCommit`;
- `commandsRun`;
- `diagnostics`;
- `changedFiles`;
- `verification`;
- `pass`;
- `failureReason`;
- `handoffSummary`.

Store machine-readable results outside this directory until a runner is added.
