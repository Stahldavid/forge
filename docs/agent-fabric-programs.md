# Agent Fabric program workflows

Current dev architecture: finite typed TypeScript → JSON IR (schemaVersion 2/operatorVersion 2) → exclusive local owner → activity scheduler → candidates/evidence → final assessment → gate → separate apply. There is no legacy interpreter or migration requirement. Start new runs after semantic upgrades. Normative architecture: `architecture/agent-fabric/WORKFLOW_PROGRAM_V2_ADR.md`; requirements and evidence are adjacent documents.

## R2.2 correction contract

Correction plan: `architecture/agent-fabric/WORKFLOW_PROGRAM_V2_CORRECTIONS.md`. Subworkflows inherit activity scopes, cancellation, dependencies, item identity and lexical loop state. Their `workflowInput()` is the explicit child input. Policy/acceptance cannot change; population is inherited and cannot be replaced. Prefer passing item data explicitly for portable child programs; static schemas remain authoritative.

The owner/store share one PID/token hardlink lease protocol, including recovery of dead reclaim guards. A live guard is never removed. Unknown process liveness stays conservative. No exactly-once external guarantee is added.

`ProgramExecutor.inputSchema` optionally validates activity input before preparation/dispatch, alongside conservative preflight inference. Output schemas remain mandatory. Typed author refs support `executorRef<Input,Output>` and `programRef<Input,Output>`; `schemaRef<Output>` types events. `output(operation)` retains output types, `field` checks typed keys, and typed map bodies retain collection result item types. `output("id")` remains schema-validated at preflight/runtime. Generics are author annotations, not inferred from registry files and not authority to weaken a schema. `WorkflowExpression`, `WorkflowValue`, `WorkflowResolved`, `WorkflowBody`, `WorkflowCollection`, `WorkflowActivityOptions` are exported type helpers. No second interpreter is introduced.

```ts
const inspect = agent("inspect", {
  executor: executorRef<{path:string},{ok:boolean}>("inspect", "v2"),
  input: {path: "src/a.ts"}
});
const ok = field(output(inspect), "ok"); // WorkflowExpression<boolean>
```

### Visual population

An owner population may declare `visualCases`, exactly one case per member:

```json
{"itemKey":"checkout-mobile-error","route":"/checkout","viewport":"mobile","state":"error","width":390,"height":844}
```

Route/viewport/state tuples and member keys must be unique; excluded members remain cataloged but are not assessed. Every observed capture must match its owner tuple and dimensions. AssessmentContext carries the current expected cases to capture/review workers. Final capture requirements recapture every active case. Item capture requirements come only from item obligations; final-only obligations do not force local screenshots. Without visualCases, coverage is per member, not an inferred matrix. Receipt metadata and valid image headers do not prove that the pixels depict the declared route/state. The WebP header parser currently accepts VP8X only.

Capture blobs commit before result; all receipts of one attempt commit atomically with the observed attempt result. Invalid batches leave no accepted partial receipts. Orphan blobs may remain until explicit maintenance; no GC is implied.

### Storage and inspection

New runs use `.forge/local/agent-fabric/program-runs-v3`. Format 3 envelopes contain snapshot/journal pointers and CAS receipts, not duplicate full snapshots/history arrays. Each immutable journal node links its predecessor; history verifies the chain and historical snapshot identities. Snapshot and journal commit before atomic envelope publication. Old directories are preserved but unused; no checkpoint migration. Identical internal mutations do not write another checkpoint; authenticated request receipts still commit. Dispatch keeps a 24 MiB snapshot reserve and 90,000-transition reserve for recovery.

`program-explain.graph` returns `nodes`, observed `instances`, `mermaid`, and graph semantics. The diagram shows static dependencies, including control completion edges; dynamic map/loop expansions are separate instances. Mermaid labels are escaped. Storage metrics split actual written bytes into snapshot/journal/envelope/artifact categories, including temp files; full state snapshots still grow with the run. Profiling does not establish model speed or quality.

Reusable examples: `examples/agent-fabric-v2/map-child.workflow.ts`, `item-child.workflow.ts`, and `visual-population.json` (owner baseline digest required).

## Start and inspect

The owner reads `.forge/fabric-programs.json`: versioned schemas, executors, policies, acceptance, populations and optional child programs. Authors select references; requests cannot substitute a weaker owner registry. Keep `forge fabric serve` alive. New dispatch/apply checks current owner authorization; immutable historical facts retain their pinned definitions.

`forge fabric program-validate --file request.json --json` accepts `{source}` or `{program}`. Start adds `{requestId,input}`. CLI mutations use request files and `{runId,requestId,expectedVersion,...}`. The HTTP owner bounds requests at 40 KiB; offline source lowering caps at 256 KiB. Every control uses CAS and idempotency; use a new requestId when changing a decision after a conflict.

| Action | Request/meaning |
|---|---|
| program-validate | source/program, no dispatch |
| program-start | requestId, source/program, input |
| program-status | --run-id ID, authoritative state |
| program-wait | runId, cursor, waitMs; bounded long poll |
| program-pause | stop new dispatch; active work is observed |
| program-resume | continue settled work without replenishing budgets |
| program-signal | signalId, target, generation, type, correlation, payload, authorization, optional subject/expiresAt |
| program-replan | source/program, mode barrier/additive/fenced |
| program-cancel | request cancellation; unknown effects remain uncertain |
| program-reconcile | attemptId or operationId, resolution failed, observed reason; publication reconciliation is separate |
| program-apply | current gated result and authorization; scoped local files |
| program-history | --run-id ID, journal/stateRefs |
| program-explain | --run-id ID, scopes/queue/scheduler/storage/guarantees |
| program-artifact-get | runId, ref; optional binary:true/maxBytes; bounded reachable artifact only |
| program-diff | runId and proposed source/program, graph changes |

MCP exposes the same 15 actions as `fabric_program_*`. Status/history/explain accept `{runId}`; other actions use `{request:BODY}`. Both use the same authenticated owner and store. Apply is not automatic.

## Complete author API: 50 constructors

Import from `forgeos/agent-fabric/workflows`. Functions create finite IR data; they do not dispatch during authoring. `WorkflowDefinition`, `WorkflowOptions`, `WorkflowRef`, `WorkflowOperation` are exported author types. Normal TS compilation and static lowerer both support `as const`/`satisfies`; lowerer never evaluates callbacks, arbitrary imports or runtime I/O. JSON authors get identical owner validation.

`defineWorkflow({id,version,operatorVersion:2,mode,inputSchema,outputSchema,policy,acceptance,population?,steps,result})` defines the root. Mode data returns typed data; candidate mode requires a gate for acceptance-ready. Schema subset supports bounded objects/arrays/scalars, properties/required/additionalProperties, enum/const, numeric/string/array bounds and anyOf; unsupported keywords reject.

Seven reference constructors share `(id,version)` and have separate nominal kinds: `schemaRef`, `executorRef`, `policyRef`, `acceptanceRef`, `populationRef`, `recipeRef`, `programRef`.

All 13 operators use `(id,options)`, with optional common `after:string[]` and label. `after` is control dependency, not an operator. Reference dependencies are also inferred; independent roots run concurrently. IDs are lexical and cycles reject before dispatch. Multi-step Blocks require `{steps,result}`; a single operation is shorthand.

| Operator | Main options and result |
|---|---|
| value | value; pure data |
| agent | executor, input?, candidate?, writeScope?; typed worker data |
| command | same activity contract; registered command executor |
| map | items,key,body,completion,coverage?,quorum?,concurrency?,order?; sealed collection with item outcomes |
| branch | condition,then,else Blocks; selected result, unused arm skipped |
| loop | initialState,maxRounds,body,next,until; final state, bounded progress |
| repair | recipe,implement,review,checks,evidence?,assessmentScope?,entryMode,initialCandidate,writeScope,maxRepairRounds,maxAssessmentAttempts,maxInfrastructureAttempts,progressPolicy; accepted or explicit nonacceptance result |
| compose | candidates,onConflict:needs-resolution; integrated candidate; conflicts block |
| gate | candidate,coverage?,authorization?; owner-issued current receipt |
| subworkflow | program,input; child result under inherited limits/contracts |
| waitEvent | type,correlation,schema,subject?,timeoutMs?; one authorized event payload |
| sequence | steps,result; serial required children |
| parallel | steps,result,onFailure:collect-all/cancel-siblings; required children with diagnostics |

All 29 expressions:

| Expression | Meaning |
|---|---|
| workflowInput() | typed input |
| item() | current map item, including nested loop |
| loopState() | current loop state |
| output(id) | data result of lexical invocation; activity envelope is unwrapped |
| field(value,key) | bounded object field |
| literal(value) | literal data, no nested expression interpretation |
| object(record) | evaluate object entries |
| array(...values) | evaluate array entries |
| eq(a,b) | canonical data equality |
| and(...values) | boolean conjunction |
| or(...values) | boolean disjunction |
| not(value) | boolean negation |
| concat(...arrays) | bounded concatenation |
| filter(values,key,equals) | field equality selection |
| unique(values,key) | first unique field values |
| sort(values,key) | UTF-8 field ordering |
| take(values,count) | bounded prefix |
| length(value) | collection/string length |
| population() | owner population contract |
| acceptance() | owner acceptance contract |
| candidateFromBaseline(entry?) | owner baseline candidate; entry bounds item context |
| outputCandidate(id) | candidate from completed activity/composition |
| acceptedCandidate(id) | accepted repair candidate with owner receipt |
| acceptedCandidates(id) | accepted candidate collection |
| coverageFor(contract,discovered) | validate discovered items against owner catalog; issue receipt |
| coverageReceipt(id) | collection coverage receipt |
| acceptanceWriteScope(id) | inherited acceptance write scope |
| approvedChecksFor(entry) | owner-approved checks for work entry |
| acceptanceChecks(id) | checks inherited from the acceptance contract |

## Recovery and scopes

Owner activity capacity is four; run and ancestor map quotas can narrow it. Parent controls do not hold activity slots. Queue admission shares the absolute run deadline. Completed intact same-run outputs are reused before workspace/adapter preparation, including mocked/real SDK output records. This is distinct from cross-run cache, which is absent. Corrupt artifacts block and do not trigger silent redispatch.

Waiting is its own state. Independent siblings continue and survive resume. Events persist before consumption; target/generation/type/correlation/subject/schema/expiry bind their use. A live owner wakes on authorized event or deadline. After restart use explicit resume. Paused stays paused. Completed data is not acceptance-ready. Unobserved cancellation/dispatch stays uncertain and retains reservations through restart until observation/reconciliation. Exactly-once external effects are not promised.

Barrier replan recomputes changed branches and dependents, preserving compatible intact facts. Additive keeps existing templates. Fenced replacement requires owner opt-in and a global barrier; this is not independent live local fencing. Repair persists intent/counters before dispatch and never refunds exhausted budgets on resume.

## UI and candidate acceptance

Owner contracts declare `requiredChecksByScope:{item,final}`, `assessmentBindings` and obligations `{id,scope,criteria,requiredEvidence?}`. Review/check/capture receive AssessmentContext with candidateRef, obligationIds, environmentRef, itemKey and evidenceRefs. Evidence files are readonly inputs. Registered capture commands return JSON `evidenceArtifacts:[{path,itemKey,buildDigest,environmentRef,mime,width,height,route,viewport,state}]`; path must be in bounded scratch storage. Owner stores immutable bytes and issues capture receipts. Invalid/missing/stale evidence blocks; it does not become a UI defect requiring implementation.

Assess-first means a correct UI produces zero edits. Review approval alone is insufficient: findings must be empty, checks passed, all obligations covered, current candidate/env/evidence bound and distinct observed reviewer attempt. Final assessment after compose recaptures the complete population and can reject an item previously approved locally. Conflicts need resolution; no automatic resolution recipe is implemented.

Map keys normalize NFC before uniqueness, encode path segments once and order by UTF-8. Completion is all-required/partial/quorum; quorum is `{minAccepted:K}`, explicit and only closes when outcomes settle. Owner must authorize partial/quorum; such a result cannot alone satisfy all-required final obligations. Envelope item outcome is distinct from arbitrary user data (including a user field named status).

If `requireHumanApproval:true`, add a wait subject `{candidate: acceptedCandidate(finalId), contract: acceptance()}` and give `output(waitId)` as gate authorization. The authenticated host supplies provenance and approved payload, not a worker. A declined/expired/fabricated approval does not authorize gate/apply.

Apply commits an immutable intent before the first write, pins candidate/contract/semantic version/seals and checks beforeimages. Multiple files are not an atomic filesystem transaction. Divergent/partial writes become apply-uncertain. Reconciliation with `publication:true` requires observed complete files; retry requires authorization and complete original baseline, then explicit resume/revalidation. Source files remain untouched until apply.

## Runnable examples and no-LLM verification

`examples/agent-fabric-v2/ui-audit.workflow.ts` is the complete UI plan. `run-ui-fixture.ts` builds 20 local HTML pages with three known defects and registered deterministic discover/capture/review/implement/local/global-check commands. Test evidence: exactly three implementations, 43 captures including 20 fresh final captures, 21 final obligations, no apply and zero LLM calls. PNG fixtures verify transport/binding. Optional explicit browser path renders local HTML in headless Chromium/Edge; visual quality is still not model-evaluated.

Run `FORGE_FABRIC_TEST_MODE=1` using the shell's environment syntax, then `node bin/forge-bun.mjs run examples/agent-fabric-v2/run-ui-fixture.ts`. The test fuse refuses default real Codex factories; stubs remain supported. Runtime profiling: `node bin/forge-bun.mjs run scripts/benchmark-fabric-workflows.ts report.json`, fixed fan-out/fault/restart, no provider. Neither is a Claude/model-quality benchmark. Future extensions (cross-run cache, distributed owner, automatic GC/resolution, unlimited streaming/race, additional harnesses) remain out of this implementation.
