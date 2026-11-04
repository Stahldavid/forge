# Accompanied execution and recovery

## Accompanied work

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
