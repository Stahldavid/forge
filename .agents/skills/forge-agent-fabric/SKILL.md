---
name: forge-agent-fabric
description: Conduct or resume a Forge Agent Fabric coding task with persistent workflow steps, independent Codex review, and source-bound evidence when the user requests this workflow.
---

# Forge Agent Fabric

Keep the user's conversation in Codex. Prepare protocol requests yourself; the user should
not need to write JSON or operate a second interface. Respect the user's task scope and
existing authorization. This skill does not authorize publication, deployments or external
messages. Use subagents for implementation/review when authorized by the user or project.

## Locate and connect

Use the framework source CLI `node bin/forge.mjs fabric` in this checkout. Use
`fabric capabilities --json` to distinguish accompanied tasks, managed SDK runs and the
legacy Ollama pilot. Both new modes need one running `fabric serve` owner. Prefer an
existing owner; if none exists, start one with a tool-managed process and record its session.
Do not open the legacy PGlite database independently or kill an unrelated owner.

Native MCP tools are `fabric_attached_*`, `fabric_workflow_*` and `fabric_run_*`. If unavailable, the CLI
offers the same operations. State which transport you actually demonstrated.
Do not register MCP or change global configuration as a side effect of using this skill.

Read [the protocol and delivery plan](../../../docs/architecture/agent-fabric/CODEX_DYNAMIC_WORKFLOWS.md)
for model fields and behavior. Resolve this path from the repository root if the skill
loader's relative reference resolver does not handle repository links.

## Conduct work

1. Create an `attached-propose` with explicit acceptance criteria, relevant file scope and
   checks. Mutations use a complete `--file` JSON request; reads use `--task-id`.
2. Attach the actual session/agent identity, register an implementation assignment and
   start its attempt. Use actual IDs from the host, not invented claims of verified identity.
3. For a composed task, record `workflow-plan` and use `workflow-next` packets. Claim a
   step before executing it, then report output digest and evidence. Before checking or
   reviewing source, capture the current snapshot digest from `attached-status`. Successful
   `workflow-result` and `workflow-reconcile` requests must include that actual observed
   digest in the top-level `observedSnapshotDigest` field. Do not fetch a newer digest merely
   to stamp an older result; if source changed, reconcile obsolete work as failed and
   replan or execute a fresh attempt. The scheduler records
   work; it does not invoke the host's subagent tools for you.
4. Complete implementation and prepare a review with a distinct reviewer attempt.
   Give that Codex subagent requirements, code and the returned exact snapshot/token.
   Submit its report only for that version. Correct findings and obtain a new review
   when files change. Do not mark findings resolved without corrective evidence.
5. Run the checks relevant to the change and record their outcomes for the current
   snapshot. Record criterion coverage with concrete artifacts or observed checks.
6. Read `attached-status`. Address the structured unmet reasons before presenting the
   task as ready. Agent-reported records retain that provenance; they are not authenticated
   service executions, human acceptance or proof of production deployment.

Reuse a requestId only for the exact same request, including expectedVersion. On a version
conflict read current state and reconcile; use a new requestId for a new operation. Mutation
responses are compact acknowledgements; status/context reads return current full state.

## Resume and adapt

Start with `attached-context` for the known taskId. Do not restart completed work from the
conversation summary alone. After a host crash use `workflow-recover` for known interrupted
attempts and reconcile their observed outcomes before dispatching them again. A missing
result is uncertainty, not success or permission to repeat an effect.

Use `workflow-replan` with the expected revision, reason and evidenceRefs. Preserve
required obligations. Source changes make recorded results stale; the service blocks
their reuse and replan invalidates affected steps and their dependents. The current
release binds results conservatively to the task's whole file scope; choose a relevant
scope and do not promise fine-grained invalidation by individual inputRefs.

Keep hooks observational. Missing hook events do not prevent explicit session/tentative
registration, but do prevent claiming that native hook integration has been demonstrated.
The accompanied mode recovers work when Codex returns. Managed SDK runs now have a
separate executor, but still require a live owner; neither mode installs automatic wakeup
or guarantees execution after the App closes.

## Managed execution

Choose managed execution when the authorized task calls for owner-dispatched SDK or
command workers. Keep the native chat as the interface and prepare requests yourself.
Starting Codex workers can consume configured credits; local publication can change
files. Use the user's existing scope and authorization, including any cost constraints.
Do not treat the legacy proposal-only MCP contract as a limit on fabric_run_start.

1. Read capabilities and the managed request example in the linked plan. Prepare
   run-start with requestId, goal, scope, workflow and one executor per node. Codex roles
   are implementer/reviewer/investigator/decision; commands use explicit argv. Choose
   relevant limits, deadlines and scope. inputDigest identifies the declared node contract;
   the owner separately captures actual source inputs. Clones do not copy root node_modules;
   automatic environment preparation installs locked dependencies or copies verified cache
   into the clone, with scripts ignored by default. Optional environment accepts mode
   auto/none, ignoreScripts, HTTPS registry without credentials/query/fragment, and timeoutMs
   100..1800000. Use none for dependency-free steps. Do not assume ignored scripts executed.
2. Start via `fabric run-start --file run.json --json` or fabric_run_start with
   `{request: BODY}`. Read `run-status --run-id ID`; use run-wait with
   `{runId,cursor,waitMs}` for bounded events, up to 30000 ms. MCP status uses `{runId}`.
   Start and mutations return compact acks; status provides full public state and artifacts.
3. For publication, use an implementer activity, a required distinct Codex reviewer
   downstream of every writer, and a required command verification downstream of every
   writer. Reviewer approval, command success and workflow completion are required.
   publish false keeps isolated artifacts; publication applies local scoped files and
   does not authorize commit, push or deployment. Do not claim that a model's report is
   executor evidence: state is executor_observed, reports remain agent_reported, and
   outputContract.requiredEvidenceKinds accepts only `executor-observed`.
4. Steer queues instruction and pauses new dispatch; it does not message the active worker.
   Pause allows active workers to finish. All controls use runId/requestId/expectedVersion.
   Resume optionally adds expectedRevision/nodes/executors/reason/evidenceRefs for replan.
   Read status after version conflicts and issue a new requestId for a changed body.
5. After cancellation or owner restart, inspect the saved thread, workspace and effects.
   Unknown attempts require run-reconcile with attemptId, resolution failed and reason;
   never manufacture success or retry uncertain effects silently. A new isolated attempt
   may use the saved SDK thread. Publication confirmation uses publication confirm only
   when the owner can observe matching expected files. Resolve uncertainty before resume.
   Publication retry is allowed only after observing the complete original baseline; it
   clears the intent and pauses. Resume explicitly; preserve partial divergent writes.

Distinguish implementation, command-fixture tests and actual SDK execution in the delivery
report. The detailed plan records a real SDK pilot separately from fixture tests; do not
extend its acceptance to a new environment or task without observed evidence. Keep the owner session
visible in task context; do not promise App-closed execution or create a scheduler implicitly.
