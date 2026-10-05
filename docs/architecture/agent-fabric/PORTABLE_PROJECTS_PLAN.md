# Agent Fabric across repositories

## Outcome and boundaries

The existing Codex App conversation remains the interface. One personal skill teaches
Codex to prepare, execute, observe and resume Fabric workflows in the current project.
The Forge runtime is shared; each Git repository has its own owner, state and isolated
worker clones. Projects do not need a Forge application manifest or a Forge dependency.
Windows and WSL copies are separate projects; this integration never migrates or syncs them.
Owner startup does not start a model. Managed Codex workers use the host's configured
Codex authentication and can consume its allowance. Local publication applies validated
files; commit, push, npm release and deployments remain separately scoped actions.

## 1. Portable skill and distribution

Maintain the skill at `.agents/skills/forge-agent-fabric`, include it and its installer
in the npm package, and make its protocol reference self-contained. Install once with
`forge fabric install-skill --json` from any directory; add `--dry-run` to preview.
The underlying `node scripts/install-agent-fabric-skill.mjs` also supports custom
destination/runtime and explicit replacement; default destination is
`~/.agents/skills/forge-agent-fabric`. Installed `runtime.json` stores the absolute
Node executable and Forge CLI path. The helper resolves the target Git root and invokes
the runtime with that root as cwd, without shell interpolation. An environment override
and installed CLI fallback support different hosts. Runtime updates require reinstalling
the skill to update the selected path/version; no implicit remote downloads occur.

The installer stages changes, preserves unknown existing skills unless explicitly replaced,
backs up replacements outside skill discovery, and reports unchanged installations.
Installing a skill neither registers all local repositories nor installs hooks.

## 2. Project identity and registration

`fabric project-register [--project-id <id>] --json` resolves the current directory to
the canonical Git toplevel and verifies HEAD. Default ids combine a readable directory
name with a root digest, so equal names in different directories do not collide.
`fabric project-list --json` reads the personal registry at
`~/.forge/agent-fabric/projects.json`. Registration uses a bounded exclusive lock and
atomic file replacement. Conflicting ids/roots and malformed or symlinked registry
files are rejected. A registered path is resolved again before dispatch; moved/replaced
roots cannot silently redirect an existing project id. Non-Git/empty repositories need
initialization and an initial commit before managed cloning can run.

The registry is host-local. No project credentials, owner bearer tokens or source contents
are stored there. Registration is explicit and does not discover every directory on disk.

## 3. Owner lifecycle and diagnostics

`fabric doctor --json` resolves the Git root, reads optional settings, checks SDK availability,
attempts a bounded `codex login status`, and authenticates any existing owner. It neither
starts workers nor creates an owner. An unverified login is reported rather than inferred.
`fabric ensure-owner --json` reuses an authenticated owner or starts `fabric serve` hidden
and detached with cwd set to this root. Logs and endpoint metadata stay under
`.forge/local/agent-fabric/`. Startup uses a per-project exclusive lock and bounded wait.
Only its own newly spawned process may be stopped if startup times out; unknown live
processes are not killed. An unreachable live endpoint requires diagnosis instead of
starting another database owner. Startup locks surviving a crash are recovered only
after their recorded process demonstrably exits, with serialized recovery and a byte
readback. Live, malformed or unverified locks require inspection; they are never erased
solely because a timer elapsed.
If a process dies during recovery itself, its `.recovery` guard can require manual
inspection after confirming that guard's process exited; diagnostics name both files.

Authenticated health checks expose root and pid, never the endpoint token. Existing owners
from the previous release are recognized through a read-only managed status probe.
The owner remains an ordinary local process: restarting the machine requires starting it
again; no OS service or periodic wakeup is installed.

## 4. Optional project profile

`.forge/fabric.json` is a small declarative file, not a Forge app configuration:

```json
{
  "schemaVersion": 1,
  "maxConcurrency": 2,
  "environment": { "mode": "auto", "ignoreScripts": true, "timeoutMs": 120000 },
  "verificationCommands": [["node", "--test"]]
}
```

The shared managed request transport merges environment/concurrency defaults into
`run-start`; explicit request values win. The profile does not change existing runs or
silently append verification nodes. The skill reads suggested argv arrays and selects
checks appropriate to the actual task. This avoids disguising executable project scripts
as configuration reads. Unknown fields, excessive files, symlinks and invalid values
are rejected. Node dependency preparation continues to use lockfiles and isolated copies;
other stacks need explicit workflow commands and available host tooling. No universal
Python/Go/Java provisioning is implied. Credentials and .env files are not copied merely
because a profile exists.

## 5. One MCP, multiple projects

Keep the shared runtime's `mcp serve` entrypoint. Add `fabric_project_register`,
`fabric_project_list`, `fabric_project_doctor`, and `fabric_owner_start`. Fabric tools
accept an optional top-level `projectId`. The router resolves registered ids, removes
the routing field before backend validation, then forwards to that root's owner.
Explicitly routed responses include `projectContext: { id, root }` for readback.
Calls without projectId retain the existing default workspace for compatibility.
Hooks and non-Fabric agent-memory tools remain bound to the configured default workspace.
Run calls cannot supply an arbitrary root. The skill must use explicit projectId outside
the default workspace, or use CLI with the current Git root as cwd.

MCP configuration remains one shared runtime entry. Restart/reconnect the Codex tool
session to discover a changed tool catalog; use the skill's CLI helper immediately while
the current conversation still has its old catalog. Do not claim tools are loaded until
they appear. Do not change unrelated MCP entries or weaken authentication to add routing.

## 6. Native chat flow

1. User requests Agent Fabric work in a project; Codex reads its AGENTS.md and task scope.
2. Skill helper resolves the root and runs capabilities/doctor.
3. Register only this project when MCP routing is needed, then ensure its owner.
4. Build a managed DAG with explicit scopes, implementers, independent reviewer and checks.
5. Dispatch through the CLI or loaded MCP tools, using bounded waits and durable cursors.
6. Replan from observed results while preserving required review/verification obligations.
7. Reconcile uncertain attempts after interruption; do not repeat effects blindly.
8. Read final project/run identity and evidence, then report actual results in the same chat.

SDK worker threads are separate executions; they are not newly created Codex App sidebar
conversations. This workflow does not require the user to operate a separate dashboard.

## 7. Validation and delivery

Validate registry contention, duplicate names/ids, nested cwd resolution, unknown/moved
roots, profile defaults and explicit overrides, owner authentication/start/reuse, MCP
routing into a second real Git repository, and hook isolation. Exercise the skill installer
against a temporary personal directory and its helper against the real runtime. Run an
observed command workflow in an external fixture without dispatching paid Codex models.
Run generation/check, targeted Fabric tests, typecheck/lint and the framework verifier.
Install the personal skill only after these checks; register Forge explicitly for current
MCP routing. Preserve existing auth, other skills, MCP configuration and unrelated files.

An external command pilot proves routing, cloning, execution and state readback. It does
not itself prove a new paid SDK implementation/review round, production deployment or
human acceptance. Package inclusion is checked separately from npm publication; this
implementation task does not require publishing a new release.
