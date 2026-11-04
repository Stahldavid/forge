# AGENTS.md

This ForgeOS app is an agent workroom. External code agents edit the app in this
directory while ForgeOS records context, hooks, checks, generated artifacts, and
handoff state.

## Task scope and validation

Use the existing user request and authorization to complete the requested work. Resolve routine choices within scope; ask only when a missing decision changes the outcome or a new external effect needs authority. Define completion by the requested behavior and relevant checks, and continue through failures caused by the change.

- Read-only investigation or prose-only edits: inspect the relevant files and existing diff. Check Markdown links or formatting when affected; do not onboard, regenerate, start a runtime or run application suites for unchanged runtime behavior.
- Authored runtime, schema, policy or generated-contract changes: inspect the relevant generated context, run `forge generate` and `forge check`, then affected tests or `forge verify --changed`. Preserve tenant/auth, transaction and effect boundaries.
- Frontend/runtime diagnosis: use `forge dev --once --json`, targeted inspection or the requested runtime only when needed. Hooks/onboarding are setup operations, not prerequisites to every edit.
- Release, broad migration or delivery with an explicit comprehensive gate: run `forge verify agent` and the applicable integration checks. Do not repeat or broaden passing checks without new changes or evidence.

Use `forge status --json`, `forge changed --json`, `forge handoff --json` or `forge agent print-context --json` when their information is needed. Select relevant context rather than running every command. Existing authorized local checks do not require approval at each step; publication, deployment and billable external work retain their own boundaries.

Do not edit:

- `src/forge/_generated/**`
- `forge.lock`

Use `forge studio attach . --target codex --preview-port 5174` to connect this
workspace to Forge Studio.
