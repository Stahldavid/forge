# Agent Memory, Fabric and Git traceability

This opt-in implementation projects committed Fabric evidence into the existing DeltaDB. Fabric remains the execution authority, Agent Memory remains the event source, and Git remains the authority for commit objects. Trace relations never authorize an action. No hook, provider, scheduler, push or deployment is activated by configuration creation or a trace query.

## Owner configuration and start

The public `forgeos/agent-fabric` entry point exports `createTraceOwnerConfiguration`, `createTraceRuntime`, `projectFabricTrace`, `explainFabricTrace`, the Git observation helpers and trace contract types. Creating a configuration returns an object; it does not save or activate it.

An explicitly configured owner reads `.forge/fabric-trace.json`:

```json
{
  "schema": "forge.fabric-trace-config.v1",
  "identity": {
    "repositoryId": "repository-A",
    "checkoutId": "checkout-A",
    "fabricStoreId": "fabric-A"
  },
  "checkoutBinding": "sha256:<computed by createTraceOwnerConfiguration>",
  "memory": { "memoryStoreId": "memory-A", "sourceNamespace": "host-A" }
}
```

Use the helper to compute the binding from the canonical checkout and Git directory. Copying this file to another checkout fails identity validation. The optional memory mapping authorizes exact event reads through the existing broker; it does not start a queue drain or create events. Identity values are explicit owner configuration, rather than a hash guessed from a branch or basename.

`program-start` accepts an optional `trace.origins` array. Each entry supplies an external origin (`issuerNamespace`, `integration`, `externalSessionId`, optional `turnId`) and compact `agentMemoryRefs`. Each memory reference contains `memoryStoreId`, `eventId`, `eventDigest` and `sourceNamespace`. A request cannot supply trusted confirmed slices, runtime callbacks or initial Git cleanliness. The owner resolves the exact committed event and hashes its normalized, sanitized slice. Pending queue entries are not committed evidence.

The owner captures Git baseline cleanliness before materializing the baseline or dispatching a worker. It binds the observation to the captured head and baseline digest. Unknown cleanliness stays unknown. The initial trace origin and manifest enter the first committed run snapshot before execution.

## Persistence and compatibility

Fabric reuses its existing content-addressed artifacts, journal and atomic per-run record in `.forge/local/agent-fabric/program-runs-v3`. A traced run has an optional `traceBindingsRef` and a format **4** record. Existing untraced runs retain format **3**. There is no automatic upgrade, downgrade or backfill of an old run.

The new reader accepts both formats. The previous alpha.72 reader rejects format 4, including a listing that encounters one, and cannot safely operate a mixed catalog. Use the new runtime for that catalog. Trace annotations on an untraced legacy run return `TRACE_UNSUPPORTED`.

`program-trace-annotate` is available through the existing authenticated Fabric owner transports, including the generated MCP action catalog. Supported annotations are `origin-event-bound`, `git-observation` and `correction`. They append immutable metadata. `requestId` replay is idempotent; reusing it with another body conflicts. Optimistic persistence version checks reject stale writes. Annotations do not change semantic version, gate, candidate, obligations, signals, execution status or dispatch counts, including on terminal runs. A correction references an earlier annotation in the same run and preserves the original evidence.

`ProgramRunStore.openReadOnly`, `cut`, `confirmedCut`, `historySuffix` and `traceArtifacts` provide bounded source reads. Only committed ancestry can seed a cut; an intact orphan CAS object is insufficient. Historical snapshots validate their full run key. Cursor/cut mismatches, missing ancestry and budget limits fail explicitly. The typed metadata closure exports origins, manifests and annotations, excluding snapshots and candidate file bytes.

## Projection and queries

Six additive tables in Delta schema `0.4.0` store generations, source occurrences, entities, relation support, issues and checkpoints. Existing Agent Memory tables are preserved. All writes use the existing single-owner Delta broker.

An occurrence is identified by generation, complete `runKey`, journal version, fact kind and fact identity. The same occurrence and digest replay without another logical insertion; a different digest conflicts. Different occurrences with equal payload remain distinct. Facts, relation support and the checkpoint commit in one transaction. An unacknowledged commit can be replayed safely.

The projector pins the inventory and a separate upper cut for each run before extraction. Later runs and later versions belong to the next pass. This is not a global snapshot. It reads a confirmed suffix and verifies its source artifacts. An unchanged cut reads no historical suffix. `sourceValidation: head-and-new-suffix` and `sourceReadMetrics` expose that scope; a no-op pass does not re-audit every old artifact.

The current extractor is `fabric-trace-v2`. Changed correction facts require a fresh projection generation; reusing a generation with a different extractor version conflicts. Rebuild from the preserved Fabric sources rather than rewriting old occurrences in place.

The CLI supports:

```sh
node bin/forge.mjs trace project --file trace-project.json --json
node bin/forge.mjs trace rebuild --file trace-rebuild.json --json
node bin/forge.mjs trace explain --file trace-query.json --json
node bin/forge.mjs trace status --json
```

Projection request example: `{"generationId":"trace-v1-A","activate":true}`. Optional `runIds` selects a bounded inventory. Rebuild requires a fresh generation ID. Query request example:

```json
{
  "runKey": { "repositoryId": "repository-A", "checkoutId": "checkout-A", "fabricStoreId": "fabric-A", "runId": "run-A" },
  "limit": 128,
  "offset": 0
}
```

Optional query filters are `generationId`, `candidateId`, `path` and `atVersion`. Request files must resolve inside the selected checkout and fit 64 KiB. CLI errors expose a stable code, not source exception text.

Only explicit project/rebuild commands may initialize an index. Status/explain require an already running broker and report unavailability otherwise; they do not open a database owner, drain queues or run GC. A generation under construction preserves the active one until its complete checkpoint set is atomically activated. Retired generations remain queryable and reject further projection writes.

The complete CLI lifecycle excludes status/explain from command recording, including unsuccessful requests. These guarantees apply without `--no-delta`: an absent index stays absent, an offline database is not restarted, and reads through an active broker add no command history.

Candidate and path filters select the corresponding evidence subgraph. Shared run or baseline context does not select sibling candidates. Git summaries belong to the selected target, including when Git records a directory scope and the candidate records individual file paths. A missing target is distinguished from a target absent from a partial page; a partial page cannot establish a complete Git verdict.

Corrections expose the sanitized reason, replacement summary and producer, with `claimKind: declared` and `authority: none`. Superseded annotations and their Git evidence remain visible as historical evidence, but do not supply the current Git summary. Replacement text is a declaration, not a new Git observation, approval or execution result. Historical queries before the correction retain the earlier view.

`fabric-current-at-cut` describes the returned source cut, not the latest event everywhere. Partial pages are labeled partial and cannot establish absence of an origin or commit outside the page. A pinned memory binding survives removal of its primary row. `explainFabricTrace` performs at most 128 exact primary reads under a total three-second budget, with at most one second per request. It distinguishes available, expired, conflicting, unavailable and unverified primary evidence. It never reconstructs a transcript.

## Evidence validity and Git

Assessments retain their generation, input and semantic digests, environment, contract and candidate identity. Current validity requires the matching owner gate and current source context, including operation generation and attempt outcomes. Historical approved text cannot approve a new context. Gate validity is recomputed when this context changes; historical relations remain evidence of their original cut.

Git observation reads full commit OIDs, raw trees/blobs, modes and parent objects. Candidate-content equivalence does not imply authorship, causality or automatic approval. Exact fixture integration additionally requires one parent equal to the pinned baseline head, a clean baseline, exact scoped bytes/modes, no outside changes, and confirmed application evidence. A host integration statement remains `declared` with `authority: none`.

An uncertain apply remains an application attempt. It becomes confirmed only through the existing Fabric reconciliation path and a committed receipt/source journal. The projector never retries publication. Reconciled receipts with `observed: true` must resolve through the committed `apply-reconciled` transition.

Dirty or staged baselines, different parents, partial commits, merges and outside changes limit the claim. Squash/cherry-pick method cannot be inferred when objects are structurally identical. Missing objects, promisor/partial repositories, transformations, CRLF/LFS and symlinks fail closed where unsupported. Verification disables hooks, fsmonitor, optional locks and replacements and does not invoke configured clean filters or implicit object fetches.

## Trace history in the next context pack

`node bin/forge.mjs agent context --handoff --json` and the existing MCP `agent_context` surface include bounded trace history when the checkout has an explicit trace configuration and an available projection. The terminal summary also reports history, cuts and evidence validity. Context retrieval does not install the configuration or activate native hooks.

The integration pins the generation and each run's journal/state cut before reading explanations. File overlap is a relevance hint, not a causal assertion. Missing mapping, partial pages, conflicts and unavailable sources remain explicit. Historical evidence is delivered with source references and validity at the pinned cut; it always has no authority to approve a new task. No new worker dispatch, gate, scheduler or publication path is introduced.

See `agent-memory.md` for context selection, unavailable states and the distinction between trace enrichment and the existing Agent Memory refresh lifecycle.

## Privacy and operational boundary

Allowed trace exports contain identifiers, digests, relative paths, statuses and bounded sanitized summaries. They exclude raw prompts, completions, command arguments, source bytes, absolute checkout roots and transcripts. Strict field allowlists, path validation, limits and the existing redactor enforce this profile. Known canary tests establish only their measured scope.

The implementation and deterministic pilot do not establish native-hook acceptance, provider behavior, Windows acceptance, production readiness or a latency SLO. Operational qualification is a separate, explicitly authorized step. See `traceability-pilot.md` for reproduction and evidence boundaries.
