# P0b — Bounded Nondeterministic Model Adapter: Scope & Gate

**Record ID:** `AF-P0B-SCOPE-2026-09-13`  
**Status:** `PLANNING_PROPOSAL`  
**Repository:** `Stahldavid/forge`  
**Planning baseline:** `main@f29b717f496b7edcd74e3f230c962e568fd0e5d2`  
**Planning baseline tree:** `49677d9979c2652c96f1cc4e0f2f82a17cb10f8e`  
**Preceding adoption event:** PR #43, S1.3 final closure  
**Implementation authority:** not granted until this planning record is independently reviewed and explicitly adopted

## 1. Purpose

P0b is the first Agent Fabric slice allowed to introduce real nondeterministic model/provider
execution. It must do so without weakening the deterministic P0a control plane that is already
accepted, normatively specified, traced and evidence-backed.

The first P0b vertical is intentionally narrow:

> execute one bounded external model inference under an already-issued P0a
> `AttemptExecutionPermit`, bind the exact authorized destination, context, materialized
> invocation and returned result to the existing permit/result lineage, and treat every
> model/provider observation as evidence rather than authority.

P0b does **not** replace P0a. The accepted P0a conductor remains the authority plane. P0b adds
a nondeterministic executor behind the existing `AgentAdapter` boundary.

This planning record is documentary only. If adopted, it authorizes implementation work only
for the `P0b-A` vertical defined below. The runtime implementation must still be separately
reviewed, evidenced and explicitly merged before any P0b behavior becomes accepted.

## 2. Frozen inputs and precedence

P0b starts from the S1.3-closed repository baseline at:

`main@f29b717f496b7edcd74e3f230c962e568fd0e5d2`

with tree:

`49677d9979c2652c96f1cc4e0f2f82a17cb10f8e`.

The following adopted inputs remain authoritative unless a later P0b change explicitly
classifies and supersedes one of them:

1. accepted P0a executable behavior and `P0A_ACCEPTANCE_RECORD.md`;
2. `S1.0B1_DECISION_FREEZE.md` / `S1.0B2_EVIDENCE_FREEZE.md`;
3. the adopted S1.1 normative kernel and conformance matrix;
4. the adopted S1.2 reference implementation design and traceability;
5. the adopted S1.3 evidence/reproduction baseline and final closure disposition.

P0b may extend the executable surface only where this scope explicitly authorizes an
extension. It may not silently weaken an existing `OP-*`, `I-*`, trust boundary, event-family
rule or replay guarantee.

In particular, these frozen rules remain unchanged:

- strategy/model output cannot manufacture authority;
- offer, claim, permit, physical execution, worker report and authoritative outcome are
  distinct;
- `WorkerResultReport` is evidence until the trusted control path commits it;
- ambiguous/late evidence becomes uncertainty rather than invented terminal state;
- replay reconstructs accepted control decisions and must not rerun cognition;
- `AgentSpec`, `HarnessSpec`, `ExecutionProfile` and `EffectiveRunSpec` remain separate;
- digest/content identity is not authorization;
- source/target/effect restrictions remain authority restrictions, not advisory metadata;
- read-only target semantics do not prohibit trusted internal control persistence.

## 3. Why P0b-A is the next bounded vertical

The frozen architecture already contains the control boundary needed for bounded model
execution:

- `EffectClass` includes `bounded_external_inference`;
- `ExecutionProfile.network` includes `provider_only`;
- `DispatchIntent` binds `sourceIds`, `targetId`, capability and effect class;
- `AgentAdapter` separates `startAttempt`, observation, outcome collection, cancellation and
  termination observation;
- an `AttemptExecutionPermit` binds attempt, worker, intent, plan revision,
  `effectiveRunSpecDigest`, grant, fencing generation and validity window;
- `EffectiveRunSpec` separately binds `contextPackDigest` and `materializationDigest`;
- a `WorkerResultReport` binds its result back to the permit lineage;
- `executeP0aActivity()` already converts adapter exceptions/unknowns and rejected late reports
  into nonterminal uncertainty rather than replaying the adapter.

P0b-A therefore does **not** need to invent a second control plane. Its job is to make the
nondeterministic executor real while preserving those boundaries.

## 4. P0b-A objective

`P0b-A — Bounded Model Invocation Adapter` SHALL provide a real provider-backed
`AgentAdapter` capable of one bounded model generation per authorized attempt.

The minimum accepted path is:

```text
verified OwnerAuthorization
  -> current ExecutionGrant including bounded_external_inference
  -> DispatchIntent(
       authorized sourceIds,
       authorized provider targetId,
       effectClass = bounded_external_inference)
  -> SchedulingClaim + lease/fence
  -> AttemptExecutionPermit
  -> exact EffectiveRunSpec
  -> exact context pack + model materialization
  -> pre-dispatch bounds + authority validation
  -> provider-only model invocation
  -> ExecutorStartupReport
  -> provider result / bounded evidence artifact
  -> WorkerResultReport
  -> existing trusted commitOutcome path
  -> AuthoritativeOutcomeCommit OR nonterminal uncertainty
```

The model/provider is outside the trusted authority plane. The adapter may execute work and
report evidence; it may not create grants, claims, permits, plan activation, resource
authority or authoritative outcomes.

## 5. Explicit P0b-A functional scope

### 5.1 Real provider execution

The adapter may invoke a provider supported by Forge's existing AI provider layer. The
current reusable provider vocabulary is `openai | anthropic | gateway` and the existing
runtime already resolves those providers through Forge secret handling and the AI SDK.

P0b-A should reuse that provider-resolution/secrets boundary rather than create a parallel
vendor SDK stack inside Agent Fabric.

Acceptance requires:

- provider/model identity is explicit before execution;
- at least one real provider path is exercised in an authorized live smoke before P0b-A
  runtime adoption;
- ordinary CI remains deterministic and must not depend on external provider availability;
- provider-specific live evidence identifies the provider/model and execution environment,
  but never publishes secret values;
- proof for one provider is not reported as live proof for every configured provider.

### 5.2 Single bounded generation, no autonomous tool loop

The first vertical is deliberately **model-only**.

P0b-A SHALL NOT execute model-selected tools, plugins, child delegation or target mutation.
For the first materialized invocation:

- `HarnessSpec.toolIds` must be empty;
- `HarnessSpec.pluginIds` must be empty;
- `HarnessSpec.delegationPolicy` must be `none`;
- persistent/project memory is not introduced by this slice;
- the provider invocation produces a text result artifact only;
- no provider function/tool calling response is interpreted as an executable instruction.

This keeps the first nondeterministic boundary observable and prevents P0b-A from smuggling a
consequential-effect broker or arbitrary agent loop into a nominal "model adapter" change.

A later tool-using or delegating model slice requires a separate scope decision.

### 5.3 Execution profile

The P0b-A execution profile must be compatible with the bounded inference operation:

- `network = provider_only`;
- `filesystem = read_only` unless a separately justified isolated temporary-write need is
  reviewed as part of the implementation;
- `durability = ephemeral` for this first slice;
- `maximumWallClockMs` must be finite and enforced by the adapter/orchestration path.

Arbitrary outbound network access is outside P0b-A.

### 5.4 Effect class and authority

A P0b-A dispatch intent MUST use:

`effectClass = bounded_external_inference`.

The exact `GoalContract`, root `OwnerAuthorization` and selected `ExecutionGrant` must permit
that effect class. A grant that authorizes only `read` or `internal_write` cannot be reused to
run a real provider invocation.

Provider inference is the one externally allowed operation in this slice. It may have
latency and billing consequences; that does not convert it into arbitrary target mutation.
No target with `consequential` semantics may be mutated by the model or adapter.

### 5.5 Provider destination is an authority-bound target

The actual provider destination SHALL be bound to the existing target-authority path.

Before any network dispatch:

1. `DispatchIntent.targetId` must resolve through a trusted, deterministic provider-target
   registry to the provider class that will actually be invoked;
2. the current grant/root authorization must already authorize that exact `targetId`;
3. the materialized invocation's provider must match the provider resolved from that target;
4. the adapter must reject a mismatch before opening a network request.

P0b-A SHALL NOT accept an arbitrary URL, base URL or host from model output, prompt content or
untrusted materialization data. The first vertical should use the existing Forge provider
resolver and its configured provider destinations. Support for arbitrary custom endpoints is a
later, separately scoped network/target-resolution feature.

This target binding prevents a permit authorized for one logical provider destination from
being reused to call another provider or an attacker-controlled endpoint.

### 5.6 Authorized source/context boundary

Content binding alone is not enough if unauthorized context can be inserted before the digest
is computed. P0b-A therefore must preserve the source boundary as well.

Before provider dispatch:

- the `DispatchIntent.sourceIds` must remain within the current goal/grant source boundary;
- the exact context pack supplied to materialization must resolve to
  `EffectiveRunSpec.contextPackDigest`;
- the resolved context pack must declare the source IDs it contains;
- those source IDs must be a subset of the authorized `DispatchIntent.sourceIds`;
- materialization may transform/format that exact context pack, but may not silently retrieve
  or append additional sources;
- P0b-A itself performs no retrieval network call other than the authorized provider request.

An injected in-memory context-pack resolver is sufficient for P0b-A; production context
storage/retrieval is outside this slice.

## 6. Materialization and boundedness contract

P0a deliberately stopped short of a full harness compiler. P0b-A needs only the minimum
materialization needed to execute the bounded model call; it must not claim the full future
Adaptive Harness Runtime is implemented.

### 6.1 Content-bound model invocation

P0b-A should introduce a bounded materialization object equivalent in responsibility to:

```text
MaterializedModelInvocation
  schemaVersion
  provider
  model
  systemPrompt
  prompt
  purpose?
  temperature?
  maxOutputTokens
  maximumRequestBytes
  outputMode = text
```

The exact field names remain an implementation design choice, but the following semantics are
required:

1. the invocation representation is immutable for one attempt;
2. a canonical digest is computed over the exact non-secret invocation representation;
3. that digest must equal the `materializationDigest` of the corresponding
   `EffectiveRunSpec`;
4. the exact `EffectiveRunSpec` must itself resolve to the
   `AttemptExecutionPermit.effectiveRunSpecDigest`;
5. its context pack must resolve to `EffectiveRunSpec.contextPackDigest` and pass the source
   checks in §5.6;
6. its provider must pass the target/provider checks in §5.5;
7. provider execution must not begin if any binding fails.

This creates the required chain:

```text
permit.effectiveRunSpecDigest
  -> exact EffectiveRunSpec
       -> contextPackDigest -> exact authorized context pack/source set
       -> materializationDigest -> exact bounded model invocation
  -> intent.targetId -> exact authorized provider destination
  -> provider/model/prompt/options actually executed
```

A prompt, context pack, provider, model or option supplied out of band after permit issuance
must not be able to replace the content-bound invocation.

### 6.2 Hard pre-dispatch bounds

`bounded_external_inference` must be bounded in executable terms, not only by name.

The adapter SHALL reject before provider dispatch unless all of these are finite and within
implementation-defined accepted maxima:

- exactly one provider request for the live attempt/permit;
- serialized non-secret request/materialization size at or below `maximumRequestBytes`;
- `maxOutputTokens` present, positive and at or below a finite configured maximum;
- `ExecutionProfile.maximumWallClockMs` present, positive and at or below a finite configured
  maximum.

The implementation may additionally enforce provider-specific input-token or cost ceilings,
but it must not rely solely on a provider-specific tokenizer to establish the baseline safety
bound. A provider-neutral serialized request-size limit is required.

If a request exceeds a bound, no network request is sent. This is a deterministic preflight
rejection, not provider uncertainty.

### 6.3 Resolver boundary

The first implementation may use injected, in-memory resolvers/registries for:

- `EffectiveRunSpec`;
- context pack;
- model materialization;
- provider target.

Production materialization/context storage is out of scope.

Resolvers are trusted only to supply candidate data for the configured IDs. The adapter must
verify content digests and authority relationships before external execution; successful
lookup alone is insufficient.

### 6.4 Secrets are not materialization content

API keys, bearer tokens and provider credentials SHALL NOT participate in canonical prompt/
materialization/result content and SHALL NOT be written into journal events, evidence bodies,
telemetry or error strings.

The materialization may identify the provider or the **name** of the required secret, but not
the secret value.

## 7. Physical-attempt semantics

### 7.1 At most one provider dispatch per in-memory attempt record

Within one live adapter instance, `startAttempt()` must be idempotent for the same
`attemptId + permitId`:

- the first call creates one attempt record and launches at most one provider invocation;
- a retry with the same attempt/permit returns the existing startup identity/state and must
  not issue a second provider call;
- reuse of the same `attemptId` with a different permit fails closed.

This is an in-process guarantee only. P0b-A does not claim crash-safe exactly-once provider
execution because production persistence and external reconciliation remain deferred.

### 7.2 Startup report meaning

`ExecutorStartupReport` means the governed executor started the permitted invocation using the
bound run-spec digest. It does not claim the remote provider has durably accepted or completed
the request unless the provider supplies separate evidence for that fact.

The implementation must define the exact point at which it records startup. It may not label
preflight-only validation as remote provider completion.

### 7.3 Restart ambiguity

If the process loses its ephemeral attempt state after provider dispatch, the system must not
invent a success/failure on restart. Without a durable provider request identity and recovery
protocol, that state is `unknown` / uncertainty evidence.

P0b-A therefore explicitly does not claim provider exactly-once execution across process
failure.

## 8. Result and evidence contract

### 8.1 Model output is evidence, not authority

Raw or parsed model output cannot directly:

- create or widen an `ExecutionGrant`;
- create a `SchedulingClaim`;
- issue a permit;
- activate a `RunPlanRevision`;
- mutate the authoritative resource ledger;
- commit an `AuthoritativeOutcomeCommit`;
- authorize a consequential effect;
- prove that the model's factual/semantic claims are correct;
- prove that the root goal's acceptance criteria are satisfied.

Strings in the model output that look like grants, approvals, tool calls, permits, shell
commands, acceptance decisions or completion claims remain untrusted output data.

### 8.2 Meaning of `succeeded` in P0b-A

For this first vertical, `WorkerResultReport.status = succeeded` means only:

> the authorized bounded model invocation completed and the complete text result artifact was
> captured under the required bindings.

It does **not** mean:

- the model answer is factually correct;
- a human/domain acceptance decision has passed;
- the `GoalContract.acceptanceCriteria` have been independently verified;
- any consequential action requested in the text is authorized.

Semantic evaluation/assurance beyond structural execution evidence is a later scope unless an
existing trusted deterministic check already performs it outside the model.

### 8.3 Successful model result

A successfully captured provider response may produce a `WorkerResultReport` with
`status = succeeded` only when:

- the exact authorized destination, context pack and permitted materialization were used;
- all pre-dispatch bounds passed;
- the complete text result required by the P0b-A result envelope was captured;
- its result digest was computed from one documented canonical result representation;
- evidence digests bind the bounded provider-execution evidence selected by the
  implementation;
- the existing P0a commit path independently revalidates the permit/intent/plan/fence/current
  authority before authoritative commit.

The trusted control plane, not the adapter, decides whether the report becomes authoritative.

### 8.4 Failure vs uncertainty

P0b-A must be conservative about failure classification.

Provider/network timeout, transport interruption, lost local state, ambiguous cancellation,
late result, or any situation where physical execution/completion cannot be proven must
produce `unknown`/`AttemptUncertaintyObservation`, not an invented `failed` outcome.

A terminal `failed` report may be used only for a condition whose semantics prove that the
attempt itself reached an admissible terminal failure and whose report remains bound to the
permit lineage.

The implementation must document every provider/error class it maps to `failed` versus
`unknown`. Default-unclassified provider errors fail toward uncertainty.

Deterministic preflight rejection before any provider request is not a physical model-attempt
failure. It must fail closed before dispatch and must not manufacture a provider result.

### 8.5 Evidence confidentiality

Normal telemetry must continue to avoid logging raw prompt bodies, credentials and sensitive
provider payloads.

P0b-A conformance may use content digests to bind exact request/result artifacts without
requiring those raw artifacts to be published in GitHub logs. If a raw live artifact is
retained for review, its storage/location, access boundary and redaction policy must be
explicit and must not expose secrets.

## 9. Cancellation and termination

Provider cancellation is best-effort unless independently observed.

For P0b-A:

- `requestCancellation()` acknowledgement is not proof that the provider stopped;
- `observeTermination()` must return `unknown` when termination cannot be established;
- a stale/expired permit or revoked grant cannot regain commit authority merely because a late
  provider response later arrives;
- late positive output follows the existing uncertainty path if it is no longer admissible.

No new authoritative cancellation event family is introduced by this first slice unless a
separate extension is explicitly scoped and adopted.

## 10. Replay boundary

P0b-A SHALL preserve `I-REPLAY-001`:

> replay reconstructs accepted decisions; cognition is not rerun.

Consequently:

- replay must never call OpenAI, Anthropic, Gateway or another external model provider;
- replay must never resolve live provider state as a prerequisite for reconstructing accepted
  control state;
- replay must never regenerate a prompt/result to see whether the provider returns the same
  text;
- replay consumes only already-accepted control events and their bound digests/provenance;
- nondeterministic provider output is frozen as evidence/result identity at the live boundary,
  not recomputed during replay.

A live provider result changing across identical requests is not itself a replay defect. A
control decision changing because replay reran the model would be a defect.

## 11. Threat model for P0b-A

The implementation and review must explicitly cover at least these threats:

1. **authority injection through model text** — output claims authority it does not possess;
2. **materialization substitution** — provider/model/prompt/options differ from the content
   bound before permit issuance;
3. **provider-target substitution / SSRF** — an authorized target is redirected to another
   provider or arbitrary network endpoint;
4. **source-boundary bypass** — unauthorized context is inserted into the model request;
5. **permit substitution** — adapter result/report is rebound to another attempt/permit;
6. **duplicate dispatch** — retries trigger multiple provider calls for one live attempt;
7. **late-result resurrection** — stale output regains commit authority after expiry/revocation;
8. **provider/transport ambiguity** — timeout or connection loss is mislabeled terminal
   success/failure;
9. **secret leakage** — API keys or credential material enter digests, telemetry, exceptions or
   evidence logs;
10. **prompt/result leakage** — sensitive request/response bodies are emitted to normal CI/logs
    without an explicit evidence policy;
11. **unbounded external access** — adapter can call arbitrary network targets instead of the
    authorized provider path;
12. **tool/effect smuggling** — model-selected tools or plugins mutate targets despite the
    model-only P0b-A scope;
13. **replay nondeterminism** — replay invokes the provider or depends on live provider state;
14. **cost amplification / oversized request** — retries or missing request/output/time bounds
    multiply spend or resource usage;
15. **semantic-success confusion** — transport/model completion is incorrectly reported as
    factual correctness or goal acceptance.

## 12. Required conformance evidence for P0b-A implementation

A future implementation PR is not adoptable solely because its happy-path live call works.
It must include deterministic evidence for the control boundary and separately identified
live-provider evidence.

### 12.1 Deterministic repository tests

Required negative/positive vectors include at minimum:

- correct permit + exact target/context/materialization -> one adapter dispatch and one bound
  report;
- wrong effective-run-spec digest -> no provider dispatch;
- wrong materialization digest -> no provider dispatch;
- wrong context-pack digest -> no provider dispatch;
- context pack containing source IDs outside `DispatchIntent.sourceIds` -> no provider dispatch;
- provider/materialization does not match `DispatchIntent.targetId` provider mapping -> no
  provider dispatch;
- arbitrary/custom endpoint supplied through materialization -> reject/no provider dispatch;
- provider/model/prompt/options substitution -> no provider dispatch;
- request above `maximumRequestBytes` -> no provider dispatch;
- invalid/unbounded `maxOutputTokens` -> no provider dispatch;
- invalid/unbounded wall-clock profile -> no provider dispatch;
- effect class other than `bounded_external_inference` -> reject before provider dispatch;
- missing authority for `bounded_external_inference` -> reject before provider dispatch;
- duplicate `startAttempt` for same permit -> no duplicate provider call;
- same attempt with different permit -> conflict/fail closed;
- provider throw before/around dispatch -> uncertainty according to documented classification;
- timeout -> uncertainty;
- cancellation acknowledgement without termination proof -> no fabricated terminal result;
- late startup/result after expiry -> uncertainty, no terminal commit;
- revoked authorization/grant after physical start -> late result cannot commit;
- forged result with wrong permit/intent/plan/spec/fence -> existing control path rejects;
- output text containing fake authority/tool/permit/acceptance instructions -> no control
  mutation and no automatic goal-acceptance claim;
- a structurally successful provider response yields invocation-execution success only, not an
  implicit factual/goal-acceptance decision;
- replay of accepted P0b result -> zero provider callbacks;
- secret canary -> absent from journal, report, evidence metadata and telemetry output;
- normal P0a deterministic adapter/conformance corpus remains green.

Provider calls in deterministic tests must use an injected fake transport/model executor, not
live network access.

### 12.2 Live nondeterministic smoke

Before runtime adoption, at least one opt-in live-provider run must prove:

- real network/provider execution occurred;
- exact provider/model coordinate is captured;
- the actual provider corresponds to the authorized `DispatchIntent.targetId`;
- the exact context pack/source set is content-bound and within the authorized source set;
- request-size, output-token and wall-clock bounds were active;
- no secret value is logged;
- the invocation was authorized as `bounded_external_inference`;
- one permit maps to one observed adapter attempt for the live process;
- result/evidence digests are produced and the accepted result can flow through the existing
  authoritative commit boundary;
- replay of the resulting accepted control prefix completes without another provider call.

The live smoke MUST NOT assert an exact natural-language answer as a deterministic oracle.
Assertions concern structure, binding, authority and evidence, not model prose.

If CI cannot safely host provider credentials, the live smoke may be a separately executed
review artifact, but its exact command, environment, subject SHA and result must be recorded.

## 13. Implementation shape authorized after planning adoption

If this planning record is adopted, a later P0b-A implementation PR may add the minimum code
needed for:

1. a provider-backed Agent Fabric adapter;
2. immutable/content-bound P0b model materialization plus in-memory resolver;
3. in-memory context-pack and provider-target resolution sufficient for the bounded vertical;
4. reuse of the existing Forge AI provider/secrets layer;
5. deterministic pre-dispatch validation for source, target, effect and request bounds;
6. bounded result/evidence digest construction;
7. timeout/cancellation/uncertainty handling;
8. deterministic conformance tests and an opt-in live-provider smoke surface;
9. necessary public experimental exports/documentation for the P0b-A adapter.

The implementation should prefer reuse over duplication. In particular, the existing Forge AI
provider resolver and `SecretsContext` should be reused unless a concrete incompatibility is
documented in the implementation PR.

## 14. Explicit exclusions

P0b-A does **not** authorize:

- production persistent/PGlite Agent Fabric journal storage;
- production transactional outbox coupling;
- crash-safe exactly-once provider invocation;
- arbitrary/custom provider endpoint resolution supplied by untrusted input;
- consequential-effect broker or arbitrary external target mutation;
- effect request/resolution/authorization/materialization/reconciliation pipeline;
- tool-using autonomous model loops;
- dynamic plugin installation or promotion;
- child-agent delegation driven by live model output;
- adaptive model routing or automatic provider selection;
- full HarnessSpec compiler/materializer;
- production context retrieval/storage or source expansion;
- project-scoped/persistent governed memory;
- Evolution Registry promotion/canary/rollback/revocation;
- integrity-unknown recovery epochs;
- production checkpoint/failover semantics;
- generic model factuality/goal-acceptance judging;
- new cross-language/JCS canonical profile;
- production-readiness or production-security certification;
- weakening any accepted P0a/S1.1 authority or replay rule.

No excluded capability becomes authorized merely because the live model adapter would benefit
from it.

## 15. Change classification boundary

The P0b-A implementation should be treated as an **extension** of the accepted runtime surface,
not a supersession of P0a.

If implementation discovers that an existing accepted invariant must change, work must stop at
that boundary and the PR must explicitly identify the affected decision/`OP-*`/`I-*`, classify
the proposed change and provide migration/conformance evidence. The existing rule must not be
silently edited to accommodate a provider implementation.

New control event families or changes to existing event semantics are **not** presumed by this
scope. If one becomes necessary, it requires explicit justification and review as part of the
implementation design rather than being smuggled in as an adapter detail.

## 16. Repository-governance prerequisite

Issue #44 records that `main` is currently not protected and required checks are not enforced
by GitHub policy.

This does not block review/adoption of this documentary planning record. It **does** block
final adoption of a materially more capable P0b runtime implementation until repository
readback proves an enforcement mechanism equivalent to the issue #44 acceptance target:

- PR-based normal merge path;
- applicable CI + Security required;
- force-push/deletion protection unless separately justified;
- unresolved review findings cannot be silently bypassed by the normal path;
- path-filtered `NOT_APPLICABLE` checks are not incorrectly required.

A P0b implementation must not claim this gate satisfied merely because humans followed the
process manually.

## 17. P0b planning adoption gate — P0B-P

This planning record may be adopted only when:

| Gate | Requirement |
| --- | --- |
| `P0B-P01` | exact S1.3 closure adoption baseline, merge parents/tree and current repository baseline are accurate |
| `P0B-P02` | first vertical is limited to one bounded real model/provider inference behind the existing `AgentAdapter`/permit boundary |
| `P0B-P03` | deterministic authority remains outside model/provider control; model output cannot manufacture grants/claims/permits/outcomes or goal acceptance |
| `P0B-P04` | provider destination is bound to authorized `DispatchIntent.targetId`; exact invocation materialization is content-bound to `EffectiveRunSpec` and the permit before network dispatch |
| `P0B-P05` | exact context pack is digest-bound and its source set is constrained to authorized `DispatchIntent.sourceIds` |
| `P0B-P06` | one request, request-size, output-token and wall-clock bounds make `bounded_external_inference` executable rather than nominal |
| `P0B-P07` | replay prohibition on provider/model re-execution is explicit |
| `P0B-P08` | timeout, transport ambiguity, cancellation and late result semantics default safely to uncertainty where terminal state is unproven |
| `P0B-P09` | tools/plugins/delegation/consequential target mutation, arbitrary endpoints and production persistence are explicitly excluded |
| `P0B-P10` | deterministic conformance vectors plus separate live-provider evidence obligations and secret/prompt/result handling are explicit |
| `P0B-P11` | issue #44 is explicitly blocking for runtime adoption; planning diff remains governance/documentation only and no P0b runtime implementation is bundled |
| `P0B-P12` | applicable repository checks and independent exact-final-SHA review report zero unresolved BLOCKER/HIGH/MEDIUM, followed by explicitly authorized merge |

Adopting `P0B-P` authorizes **implementation work for P0b-A only**. It does not accept any
runtime implementation and does not authorize P0b-B or the excluded capabilities above.

## 18. Future P0b-A runtime adoption gate — P0B-A

A later implementation PR may be adopted only when all of the following are true:

| Gate | Required evidence |
| --- | --- |
| `P0B-A01` | implementation is based on the exact adopted P0b planning baseline and relevant baseline movement is assessed |
| `P0B-A02` | one real provider-backed adapter exists without a second authority/control plane |
| `P0B-A03` | provider destination, context pack, model materialization and `EffectiveRunSpec`/permit digest chain are enforced before provider dispatch |
| `P0B-A04` | dispatch effect class is exactly `bounded_external_inference` and current goal/authorization/grant permit its target, sources and effect |
| `P0B-A05` | request-size, output-token, one-call and wall-clock limits are finite and fail before network dispatch when exceeded |
| `P0B-A06` | same live attempt/permit cannot cause duplicate provider dispatch inside one adapter instance |
| `P0B-A07` | provider output remains non-authoritative evidence; invocation success is not conflated with factual correctness or goal acceptance |
| `P0B-A08` | ambiguity/late/cancellation/revocation vectors cannot fabricate a terminal authoritative result |
| `P0B-A09` | replay of accepted P0b control state performs zero provider/model callbacks |
| `P0B-A10` | deterministic negative/positive conformance suite is complete and P0a/S1.1 regression corpus remains green |
| `P0B-A11` | at least one live-provider smoke is captured with exact SHA/environment/provider/model/authorized target and no leaked secret values |
| `P0B-A12` | no tools/plugins/delegation/consequential target effects, arbitrary endpoints, production persistence/recovery or adaptive routing are bundled |
| `P0B-A13` | issue #44 repository enforcement prerequisite is satisfied and verified by readback; applicable CI and fail-closed Security Assurance succeed on the final candidate with path-filtered skips classified accurately |
| `P0B-A14` | independent exact-final-SHA review reports zero unresolved BLOCKER/HIGH/MEDIUM, followed by an explicitly authorized merge |

## 19. Success condition for the first P0b vertical

P0b-A is successful when Forge can demonstrate the following without overclaiming:

> A real external model was invoked nondeterministically, but every authority-changing
> decision remained deterministic and governed by the existing P0a control plane; the exact
> provider target, authorized source context, invocation and result were content-bound to one
> authorized attempt; request/output/time bounds constrained the external inference; ambiguous
> execution became uncertainty; model text remained non-authoritative; and replay reconstructed
> the accepted state without rerunning the model.

That is the first meaningful step beyond the deterministic P0a proof while preserving the
architecture's central trust boundary.
