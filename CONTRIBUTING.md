# Contributing

ForgeOS uses Changesets for npm versioning and GitHub Actions Trusted Publishing for
release authentication. Choose the project and authorized effects before selecting
commands. Source facts explain behavior; they do not authorize a new operation.

## Choose the project route

| Task | Project identity and command route | Context to read |
| --- | --- | --- |
| Maintain ForgeOS itself | This framework/compiler checkout; `node bin/forge.mjs ...` or `npm run forge -- ...` | Root AGENTS.md, relevant source and package scripts; generated contracts only as needed |
| Develop a generated Forge app | The app's root and installed CLI/package script | That app's AGENTS.md, manifest, generated contract and current app checks |
| Analyze an arbitrary repository | Its selected root; portable repository helpers/skill; no Forge app dependency required | Its instructions, bounded source evidence and [repository analysis](docs/repository-analysis.md) |
| Conduct Fabric work | Explicit target Git root with HEAD, separate from the installed runtime; exact projectId for registered routing | [Fabric](docs/agent-fabric.md), the skill's bundled references and actual tool schemas |

Windows and WSL checkouts are distinct roots. Record the actual root, ref and dirty
state; do not switch to the runtime checkout to work on another project. CLI work
bound to cwd does not require project registration. A fixed-root MCP server must
match the target; where a tool supports projectId, select it explicitly. Inspect
the actual schema rather than assuming all Fabric contracts use the same version.

The generated AGENTS Project label is generic. In this repository, the framework
entrypoint and current human routing notes qualify it. The quoted Cursor Cloud
notes retain their original bytes as historical context; old test counts, machine
paths, cleanup recipes and approvals are not instructions for the current task.
Preserve other people's files and concurrent edits. Review derived changes with
their source owner and a scoped diff; do not discard a whole working tree to
remove generated output.

## Command effects and authorization

These are procedures for an authorized task, not setup required for passive reading.

| Operation | Effect and task boundary |
| --- | --- |
| Bounded file/Git reads, diff, link and marker checks | Static inspection; sufficient for a task expressly limited to documentation/static validation |
| `bun install --ignore-scripts` | Writes dependencies and may affect lock state; Bun is the framework's canonical package manager/test runner |
| `node bin/forge.mjs generate` | Writes generated contracts, lock data and the deterministic AGENTS header; derived output needs its source owner |
| `node bin/forge.mjs dev` | Starts app development services; `--once --json` still runs the diagnostic/orchestration path |
| `node bin/forge.mjs verify --standard` / `--strict` | Executes app-oriented checks and generation/verification paths; app-level strict skips the framework TestGraph in this checkout |
| `node bin/forge.mjs verify framework` | Maintainer gate that enables the framework TestGraph; use it for full framework verification |
| Fabric helper `doctor` / `capabilities` | Runtime diagnostics/discovery for operational Fabric work; not required for reading source |
| Fabric helper `ensure-owner` | Reuses or starts a detached owner; does not dispatch workers by itself |
| Fabric `project-register`, manifest/map preparation | Registration writes state; manifest/map creation writes artifacts. Discovery proposes a manifest; it does not approve edits or execute suggested checks |
| Fabric managed start / local publication | Workers may install dependencies in prepared clones and spend configured credits; publication applies scoped local files after required review/check gates |
| Skill installation, hooks/MCP/global configuration | Installation or configuration changes; using a skill does not authorize them |
| Release smoke, publish, push, merge or deployment | Smoke packs/creates/installs/runs an external app; publication and remote actions require their own task authorization |

The source CLI supports Node >=22.14; Node support does not change the Bun lockfile
or make `npm install` the canonical framework setup. Installed Forge app commands
and arbitrary-repository checks belong to their respective roots and manifests.

## Validate the current task

For prose-only work expressly limited to static validation, use bounded source
reads, `git diff --check`, local link/anchor/frontmatter checks and marker/byte
preservation checks. Inspect scripts, parser and workflows as source to confirm
documented commands. Report runtime, generator, installation and CI checks as not
run. Do not run onboard, dev, generate, verify, owner startup or an installer merely
to validate wording. Future remote CI selection is separate from this local scope.

For authorized framework code changes, select checks by impact and project rules:

```bash
bun run typecheck
bun run lint
bun test tests/<area>
node bin/forge.mjs generate --check
node bin/forge.mjs verify --standard --script-timeout-ms 120000
```

Use the full framework gate when required for the change or handoff:

```bash
bun test --timeout 120000
node bin/forge.mjs verify framework --script-timeout-ms 120000
```

Generated-app verification uses the app's installed command and its own source
context. A framework check is not an end-to-end app proof. Before an authorized
release candidate, the external-app smoke procedures are:

```bash
npm run release:smoke
npm run field:test -- --dry-run --json
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "file:." --install --json
```

The dry-run planner is distinct from installed app execution. Use the Field Tests
workflow for broader coverage when remote execution is authorized. Preserve failures
and uncertainty; a model report is not evidence that a command or CI actually ran.

## Compact task prompts and handoffs

Use a short task packet, then reference the relevant instructions and source paths.
Read progressively; do not paste every contract, trace or old conversation into
every prompt. This template is a starting point whose fields must be filled from
observed state and the human request:

```text
Objective and acceptance: <concrete result, current obligations>
Project: <framework/app/repository/Fabric route; exact root; ref/HEAD; dirty state>
Scope: <allowed paths; protected human/derived/concurrent work; relevant sources>
Effects and authorization: <allowed reads/writes/execution/cost/remote actions>
Validation: <proportionate checks; required independent review; not-run limits>
Evidence: <source paths or receipts with snapshot/cut and provenance>
Resume: <known task/run/request IDs; current version; completed/open/uncertain work>
```

For a documentation task, explicitly state allowed paths, static checks and
excluded operational effects. For code work, identify the
framework/app checks and separate implementation, command verification, CI,
publication and deployment. For Fabric, add the exact projectId/schema, snapshot
and review token, requestId/expectedVersion, required evidence and publication
conditions from the real tool contract. Reuse requestId only for the identical
request; reconcile changed versions and uncertain effects before resuming.

A handoff reports observed root/ref/status, changed paths, completed evidence,
unresolved gaps and the next authorized step. `executor_observed` state and
`agent_reported` reports retain their distinct provenance; the evidence-kind value
`executor-observed` is a separate contract field. Historical source facts and approval
for another task do not expand current scope. Valid human authorization for the same
task and effects continues across turns.

Use the existing [Agent Memory](docs/agent-memory.md) and
[Fabric traceability](docs/agent-fabric-traceability.md) contracts. Historical context
is `historical-context-only`, with `authority: none` and
`approvalForNewTask: not-evaluated`; preserve cuts, source validity and gaps.
A quoted human note is not a serialized trace record, a new observation or an
approval mechanism.

For consumer guidance, consult the official [GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model),
[skills and prompts guidance](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra),
[AGENTS documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [skills documentation](https://learn.chatgpt.com/docs/build-skills).
API request parameters are not Codex configuration fields. Catalog visibility,
context budgets, effective instruction discovery and model/runtime behavior depend
on the actual consumer; this documentation change does not measure or configure them.

## Documentation

Public docs are built with MkDocs on ReadTheDocs. Configuration lives in
`.readthedocs.yaml`, `mkdocs.yml` and `docs/**`. Keep
[getting started](docs/getting-started.md), [CLI](docs/cli.md) and
[field testing](docs/field-testing.md) current when install, template or verification
behavior changes. CONTRIBUTING is the framework routing/effects reference; the
portable Fabric skill uses its bundled references and does not require this checkout.

## CI and release boundaries

The [main CI workflow](.github/workflows/ci.yml) handles PR, main/master pushes and
dispatch, with `docs/**` ignored. Its Ubuntu verification retains the full Fabric
tests; an extra critical subset does not replace them. Path classification selects
additional runtime/template/package smoke jobs. PR breadth smoke uses Ubuntu and
Windows on Node 22; main/dispatch also add Ubuntu Node 24 and macOS Node 22. Retained
matrix check names do not imply full runtime execution in every cell.
[Security Assurance](.github/workflows/security-assurance.yml) is a separate gate.

[Field Tests](.github/workflows/field-tests.yml) supports dispatch and the Monday
07:00 UTC schedule (`0 7 * * 1`). Its app matrix covers Ubuntu/Windows/macOS,
Node 22/24 and npm/pnpm/yarn/bun. These are separate coverage profiles.

README.md, AGENTS.md, CONTRIBUTING.md and the Fabric skill are outside `docs/**`.
Their documentary nature does not promise skipped CI. No local static review proves
a future remote result or grants push/dispatch authorization.

The [release workflow](.github/workflows/publish.yml) opens/updates a Changesets
version PR on main and validates a new candidate when its conditions apply.
Merging a version PR does not publish. Main pushes never publish npm packages.
The npm publication job requires explicit dispatch or a supported `v*` /
`forgeos-v*` tag and retains its release gates. [GitHub Packages](.github/workflows/github-packages.yml)
also requires explicit dispatch or a supported tag. Current prereleases use `alpha`.

CI is defined in repository workflows and does not depend on a personal Hermes
orchestrator. Retained evidence for [PR #83](https://github.com/Stahldavid/forge/pull/83),
merged as `b68236cafa4ead175b1e06ea137697f352499883` on 2026-10-15 at 23:15:05 UTC,
records green post-merge [CI](https://github.com/Stahldavid/forge/actions/runs/38822443706),
[Security Assurance](https://github.com/Stahldavid/forge/actions/runs/38822444141),
[Nuxt](https://github.com/Stahldavid/forge/actions/runs/38822443647) and
[release validation](https://github.com/Stahldavid/forge/actions/runs/38822443532)
by 23:23 UTC. That historical receipt records manual publication skipped, unchanged
npm metadata/releases and zero deployments. The identified personal Hermes chain
had its single Forge hook disabled while queues/backups were preserved; this does
not establish universal retirement of every integration. The
[user-controlled evidence record](https://chatgpt.com/space/page_790033f7197c81918ae9faf99515bac7)
retains that operational scope. This documentation session did not rerun CI/runtime
and does not attribute those green results to a later documentation HEAD.

## Changesets

For changes that should be published, add a changeset with `npm run changeset`.
The main workflow prepares the version PR and candidate validation; publication
remains an explicit tag/dispatch operation as described above.

## npm Trusted Publisher Setup

For an authorized release setup, configure npm package `forgeos` with:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization/user | `Stahldavid` |
| Repository | `forge` |
| Workflow filename | `publish.yml` |
| Environment | blank |
| Allowed action | `npm publish` |

Do not configure `NPM_TOKEN` for normal releases. The workflow uses GitHub OIDC
with `id-token: write`, Node 24, npm 11+ and provenance. In npm package settings,
prefer "Require two-factor authentication and disallow tokens"; Trusted Publishers
continue to work with that stricter token setting. This procedure grants no authority
to change credentials, permissions or publishing configuration during unrelated work.

## Explicit publish

Local first-package creation is a controlled fallback requiring release authorization:

```bash
npm run release:smoke
npm run release:publish-local-alpha -- --dry-run
npm run release:publish-local-alpha -- --yes
```

After the package exists and Trusted Publishing is configured, prefer the explicit
OIDC workflow:

```bash
gh workflow run publish.yml
```

Tag fallback accepts `v*` and `forgeos-v*`; the tag version must match package.json.
A dry run, successful local checks or a version-PR merge alone does not publish.

## Separate functional follow-up proposals

These are proposals for a separately authorized implementation batch:

- **B1 — generator routing and durable guidance.** Change the source generator's
  generic application label to distinguish framework/app roots, and place task
  routing before operational recipes in generated output. Define source ownership
  and preserve the current human notes. The current `extractUserNotes` path already
  extracts/reinjects the marker interior; this documentary edit relies on that static
  source reading and has not run generation.
- **B2 — preservation diagnostics.** Define behavior for absent, partial, reversed
  or invalid markers and text outside them. Diagnose and preserve affected human
  text before regeneration rather than silently losing it. Test normal notes,
  malformed markers, external text and deterministic header/adapter output with
  source plus derived output reviewed together. This batch changes no generator,
  adapter, installer, configuration or generated file.
- **B3 — consumer discovery evidence.** If requested, measure installed-skill
  discovery, effective instruction/context limits and an explicitly scoped Fabric
  pilot in the actual consumer. Preserve project/root/schema, distinct review,
  request/version, evidence and uncertainty contracts. Do not install/register
  hooks/MCP, change models/tools or launch paid workers merely to document them.

The first two proposals require real generator/regression checks when implemented.
They are not fixed by this prose edit and are not gates requiring operational
execution during the current static documentation task.
