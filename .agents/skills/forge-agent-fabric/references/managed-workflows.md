# Managed Codex workflows

Commands below are Fabric operation arguments forwarded through `scripts/fabric.mjs`.
Use the current target Git root, not the directory containing the runtime. The owner
captures source from that root and creates isolated Git clones. No root node_modules
directory is shared with clones. A runtime installation is reusable across repositories.

## Request shape

Prepare `run-start --file <absolute-request.json> --json`; the request file must be inside
the target Git root. Mutations use a complete JSON
body; reads use `run-status --run-id ID --json`. The following command-only example
needs an existing tracked `source.txt` and a working absolute Node executable. Generate
a fresh requestId for each independent run. Replace example paths with observed paths.

```json
{
  "requestId": "command-smoke-1",
  "goal": "Observe a command in an isolated clone",
  "scope": ["source.txt"],
  "publish": false,
  "environment": {"mode": "none"},
  "workflow": {"workflowId": "command-smoke", "nodes": [{
    "nodeId": "verify", "kind": "verification", "dependsOn": [],
    "inputDigest": "sha256:2689367b205c16ce32ed4200942b8b8b1e262dfc70d9bc9fbc77c49699a4f1df",
    "required": true,
    "outputContract": {"requiredEvidenceKinds": ["executor-observed"]}
  }]},
  "executors": [{"nodeId": "verify", "type": "command",
    "argv": ["/absolute/path/to/node", "-e", "process.stdout.write('ok')"],
    "timeoutMs": 10000}]
}
```

inputDigest describes the node contract, not the observed source. Calculate SHA-256
for each actual declared contract. The example digest is SHA-256 of `ok` for this smoke.
The owner separately captures source inputs. Evidence kind `executor-observed` means
execution was observed; a model report's content remains `agent_reported`.

For code use `implement -> review -> verify` with one executor per node:

- implement: `kind: activity`, executor `{nodeId,type:"codex",role:"implementer",prompt,writeScope:[...]}`.
- review: required activity, Codex `role:"reviewer"`, depending on every writer, prompt requesting independent review and explicit approval/findings.
- verify: required verification, `type:"command"`, explicit `argv`, depending on every writer; use actual project tests/build checks.

Scopes and writeScope are repository-relative. Ensure writeScope stays inside the run
scope. Set timeoutMs and limits appropriate to the task. Use capabilities/doctor to check
current constraints. Maximum supported concurrency is four; prefer a small useful fanout.
Do not prescribe a test command without reading the project's scripts or AGENTS.md.

Optional top-level run environment: mode `auto` (default) or `none`, ignoreScripts (default
true), HTTPS registry without credentials/query/fragment, timeoutMs 100..1800000.
Auto prepares locked dependencies or copies verified cache content into the clone.
Ignored scripts have not executed; enable necessary preparation only within authorization.
An optional `.forge/fabric.json` profile supplies maxConcurrency and environment defaults
for run-start; explicit request fields win. verificationCommands are suggested argv arrays
for the agent to select, never commands executed by doctor. Supported profile shape:
`{schemaVersion:1,maxConcurrency:2,environment:{mode:"auto",ignoreScripts:true},verificationCommands:[["node","--test"]]}`.

Publication is local file application, not npm publication. `publish:false` keeps clones
and artifacts. `publish:true` (the default) requires approval from a distinct required
Codex reviewer and successful required command verification downstream of all writers.
Do not claim a model report proves a successful command, production deployment or human
acceptance. Run with explicit publication intent matching the user's request.

## Controls and recovery

| Operation | Body |
| --- | --- |
| run-wait | `{runId,cursor?,waitMs}`; waitMs 0..30000 |
| run-pause/run-resume/run-cancel | `{runId,requestId,expectedVersion}` |
| run-steer | CAS fields plus `instruction`; pauses new dispatch |
| run-reconcile | CAS fields plus `{attemptId,resolution:"failed",reason}` for uncertain attempts |

Mutation acknowledgements are compact. Read run-status for full public state, source
versions, attempts, artifacts and unmet requirements. Reuse requestId only for an exact
body replay. After a version conflict read status and create a new requestId for a changed
operation. Pause allows active workers to finish; steer does not inject messages into the
active worker. Cancel requests interruption without rolling back external effects.

Resume can replan with expectedRevision, nodes, executors, reason and evidenceRefs.
Preserve required obligations, evidence requirements and limits. Source changes invalidate
applicable results. Failed or uncertain attempts must not be represented as success.

After an owner restart or interruption inspect saved workspace, SDK thread ID and effects.
Unknown results require reconciliation before retry. New isolated attempts may reuse a
saved SDK thread. Publication confirmation `{publication:"confirm"}` requires the owner
to observe matching expected files. Retry `{publication:"retry"}` requires the complete
original baseline, pauses the run, and needs explicit resume. Preserve divergent partial
writes instead of overwriting them.

MCP run mutations receive `{request: BODY}` plus projectId when routing is enabled;
status receives `{runId}` plus projectId. Always inspect the available tool schema.
CLI and MCP must target the same registered root. A configured MCP server being present
does not prove its tool catalog is loaded or its owner is alive.
