# Managed execution and program contracts

## Managed execution

Choose managed execution when the authorized task calls for owner-dispatched SDK or
command workers. Keep the native chat as the interface and prepare requests yourself.
Starting Codex workers can consume configured credits; local publication can change
files. Use the user's existing scope and authorization, including any cost constraints.
Do not treat the legacy proposal-only MCP contract as a limit on fabric_run_start.

1. Read capabilities and the managed request example in the bundled reference. Prepare
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
report. Do not extend a past pilot's acceptance to a new environment or task without
observed evidence. SDK workers are separate runs, not new chats in the sidebar. Keep the owner session
visible in task context; do not promise App-closed execution or create a scheduler implicitly.

## Program workflows v2

For new finite typed workflows use the installed `docs/agent-fabric-programs.md` and
`examples/agent-fabric-v2/`. The authoring module is `forgeos/agent-fabric/workflows`.
`program-validate`, `program-start`, `program-status`, `program-wait` and subsequent
`program-*` mutations use the existing owner; MCP exposes `fabric_program_*`.
Validate source against the owner registry before dispatch. Every mutation needs a unique
requestId; subsequent mutations pin expectedVersion. Never treat data-only completed as
acceptance-ready or infer authority to apply from a worker's report. Preserve uncertain
outcomes and reconcile observed effects before resume. Fenced replan uses a global barrier;
Same-run completed output reuse happens before worker preparation; cross-run SDK caching is absent.
Use operatorVersion 2, explicit Blocks/results, after/sequence and waiting semantics; no legacy migration is required.
For scoped UI acceptance require item/final owner checks, current evidence and full final obligations.
Use program-history/program-explain/program-artifact-get/program-diff for inspection.
When avoiding LLM spending set FORGE_FABRIC_TEST_MODE=1 and use deterministic adapters/SDK stubs.
Publication still requires the user's task authorization.

## Workflow correction contract R2.2

Program subworkflows inherit ancestor activity quotas and cancellation; input is explicit. Owner visualCases binds route/viewport/state/dimensions to each population member; do not promise exhaustive UI coverage beyond that catalog. Capture obligations apply by assessment scope. New program runs use program-runs-v3/format 3 with immutable linked journal; no migration of old runs. program-explain includes graph nodes, observed instances and Mermaid. Typed refs/output(operation) improve authoring, while owner schemas remain authoritative. See docs/agent-fabric-programs.md and WORKFLOW_PROGRAM_V2_CORRECTIONS.md in the Forge source. For deterministic validation keep FORGE_FABRIC_TEST_MODE=1; do not launch real providers without explicit user authority.
