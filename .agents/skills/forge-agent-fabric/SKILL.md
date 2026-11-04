---
name: forge-agent-fabric
description: Conduct or resume Forge Agent Fabric tasks, or prepare source-bound repository maps and context.
---

# Forge Agent Fabric

Keep the user's native conversation as the interface. Respect the requested scope and existing authorization; a skill does not authorize publication, deployment, external messages or paid workers. Use subagents only when the user or applicable project instructions authorize delegation.

## Select the route

- Repository maps or static context: read [repository analysis](references/repository-analysis.md). Discovery and analysis do not require a Forge app. Do not execute manifest checks, build, start containers or install hooks/MCP merely to analyze source.
- Record work done by the native session: read [accompanied work and recovery](references/accompanied-work.md). A distinct reviewer and current snapshot evidence remain necessary where that protocol requires them.
- Owner-dispatched SDK/command workers or program workflows: read [managed execution](references/managed-execution.md), then [request fields](references/managed-workflows.md) only when preparing a managed request. Do not load execution procedures for static inspection.

## Bind the project and runtime

Use this single portable skill contract across systems. Before a platform-specific operation, identify the actual executor OS, shell and whether execution is local or remote; choose compatible commands and paths for that executor, not the client host. Consult only the platform reference needed for that operation. Resolve the authorized target Git root and its applicable AGENTS.md. Windows and WSL copies are independent. Keep the target root as cwd; do not switch into the installed runtime's checkout. This workflow does not require a Forge project dependency.

Use `node <skill-directory>/scripts/fabric.mjs --project <target-git-root> <operation> --json`. It reads installer-generated runtime.json or FORGE_FABRIC_CLI and falls back to the installed runtime. Keep platform paths, runtime pins and activation state in runtime.json or runtime configuration outside this portable prompt; do not create a separate WSL skill variant. Installation does not activate an owner, register MCP or launch workers. Source files do not prove consumer discovery or operation.

Use available native MCP capabilities or the matching CLI transport. MCP routing must select the registered project explicitly; a fixed-root server is suitable only when its root matches. Do not register MCP or change global configuration as a side effect. Registration is needed for multiproject MCP routing, not ordinary cwd-bound CLI work.

Inspect existing status/context/capabilities before resuming a known task. Run diagnostic `doctor` when needed; `ensure-owner` may start a process and belongs only to an authorized execution route. Never open the legacy database independently, kill another owner or launch workers to prove installation.

## Evidence and completion

Maps are static source evidence, not runtime or test coverage. Scope checks to the change and keep source snapshots current. Preserve task/owner/run identities and provenance: agent reports, executor observations and human acceptance are different evidence. Missing or uncertain effects require reconciliation before a retry; never manufacture success from a report or historical exit zero.

Complete the authorized outcome and relevant checks. Broaden or repeat checks only when a change, failure or unresolved concern justifies it. Setup, paid inference, publication and deployment retain their own boundaries; explain a concrete blocker and the exact governing instruction if one prevents completion.
