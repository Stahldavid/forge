# Agent Evals

ForgeOS should prove agent-native claims with repeatable evals, not only demos.

The primary eval question is:

> Can an agent modify an existing app without breaking runtime boundaries, policies, frontend/backend wiring, generated artifacts, package placement, or verification?

## Eval categories

| Category | What it tests |
|----------|---------------|
| Runtime boundaries | Commands stay transactional; actions handle side effects; queries stay read-only. |
| Frontend/backend wiring | UI uses generated hooks and capability map stays accurate. |
| Package placement | SDKs are imported only in compatible runtimes. |
| Secrets misuse | Runtime code uses `ctx.secrets` and never leaks secret values to generated/frontend surfaces. |
| Policy and tenant scope | Changes preserve authorization and tenant isolation. |
| Generated-file drift | Agents avoid hand-editing generated files and regenerate after source changes. |
| Refactor safety | Renames use Forge plans and preserve frontend/test references. |
| Repair loop | Diagnostics lead to deterministic fixes instead of broad rewrites. |
| Integration install | Agents use `forge add`, `forge deps inspect`, and `forge deps api` before calling SDKs. |
| Handoff quality | The final report names changed files, commands run, risks, and unresolved gaps. |

## Minimal harness shape

Each task should define:

- starting template or fixture app;
- user objective;
- forbidden shortcuts;
- required Forge commands;
- expected changed files;
- expected diagnostics or verification result;
- scoring rubric.

The repository includes an initial scaffold in `evals/`. It is intentionally runner-agnostic so the same task can be used with Codex, Claude Code, Cursor, or a local scripted harness.

## First benchmark set

Start with six tasks:

1. Safe feature change in `minimal-web`.
2. Policy-blocked unsafe command edit.
3. Frontend/backend wiring repair.
4. Package runtime placement violation and fix.
5. Generated drift recovery.
6. Convex app-contract recipe evaluation without replacing Convex.

These tasks are more useful than another generic CRUD benchmark because they measure whether ForgeOS narrows the error space for agents working on real app maintenance.

## Reporting results

For every run, record:

- model/tool and version;
- ForgeOS version or commit;
- task name;
- whether the agent used ForgeOS commands;
- pass/fail and reason;
- diagnostics encountered;
- verification commands and exit codes;
- final handoff quality.

Publish aggregate results alongside field-test reports before calling the core beta-ready.

## Related pages

- [AI Coding with ForgeOS](ai-coding-with-forgeos.md)
- [Agent-Native Demos](demos.md)
- [Field Testing](field-testing.md)
- [Production Readiness](production-readiness.md)
