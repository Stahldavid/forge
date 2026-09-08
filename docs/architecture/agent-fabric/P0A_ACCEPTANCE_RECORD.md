# P0a Acceptance Record

**Record ID:** `AF-P0A-ACCEPTANCE-2026-09-08`  
**Accepted implementation:** `bfd2639579e650d4ad38ec1a81dbd55a5d68865e`  
**Merged to main as:** `8972496f09727456b8b9f3ceafc386beab5f39d0`  
**PR:** `#9 — feat: add Forge Agent Fabric P0a protocol kernel`  
**Acceptance event:** completed  
**Formal record adoption:** becomes repository-native when this governance package is merged

## 1. Acceptance decision

The Forge Agent Fabric **P0a deterministic protocol vertical** is accepted as the executable
baseline for subsequent Agent Fabric architecture work.

Acceptance is based on the exact reviewed implementation head:

`bfd2639579e650d4ad38ec1a81dbd55a5d68865e`

and its merge to `main` through:

`8972496f09727456b8b9f3ceafc386beab5f39d0`.

The final independent review of the exact implementation head returned:

- BLOCKER: `0`
- HIGH: `0`
- MEDIUM: `0`
- verdict: `A. READY_FOR_MERGE_REVIEW`

Before merge, the same exact head had successful:

- CI;
- Security Assurance;
- Nuxt Template Smoke.

This record does not retroactively accept earlier P0a review heads. Earlier heads are part
of the evidence/history chain only.

## 2. What is accepted

The following capabilities/semantics are accepted **within the experimental P0a scope**.

### Authority ingress and lineage

Accepted:

- explicit `OwnerAuthorization` as root authority input;
- content-bound `OwnerAuthorizationVerification`;
- deterministic/offline verification during replay;
- root grants constrained by verified owner authorization;
- child grants constrained by monotonic attenuation;
- transitive revocation/expiry currentness;
- exact binding from execution permit through plan/goal to the goal's root authorization;
- derived grant currentness depending on its resource reservation.

### Goal/plan semantics

Accepted:

- explicit `GoalContract` with objectives/non-objectives/acceptance/effect/source boundary;
- `WorkflowProgramVersion` distinct from execution-local `RunPlanRevision`;
- explicit `PlanDelta`-based plan evolution;
- exact plan lineage validation in the deterministic control plane;
- separation of plan/materialization identity from execution authority.

### Dispatch / scheduling / execution authority

Accepted:

- durable `DispatchIntent`;
- explicitly non-authoritative `DispatchOffer`;
- `SchedulingClaim` with lease and fencing generation;
- stream-global attempt identity;
- at most one permit per attempt;
- exact `AttemptExecutionPermit` binding to intent/claim/attempt/worker/plan/spec/grant/fence/time;
- stale lease/fence/authority preventing authoritative progression.

### Worker evidence / outcome semantics

Accepted:

- startup and worker result reports as evidence inputs rather than self-authorizing state;
- canonical result-report provenance binding;
- replay-side recomputation of persisted report digest;
- `AttemptUncertaintyObservation` distinct from terminal outcome;
- late/ambiguous positive evidence retained as uncertainty rather than invented terminal
  state;
- uncertainty not terminalizing an intent by itself;
- P0a terminal outcomes restricted to `succeeded | failed`.

### Resource accounting

Accepted:

- explicit resource definitions and `consumable | capacity | counter` semantics;
- deterministic reserve/consume/release accounting;
- global and per-owner resource accounting;
- prevention of aggregate overcommit;
- conductor-owned canonical resource state;
- replay hydration on resume;
- caller-owned mutable ledger state not acting as authority;
- conflicting resume state failing closed;
- resource reservation currentness participating in delegated authority.

### Journal / replay semantics

Accepted:

- event envelopes with sequence/predecessor/digest/time lineage;
- immutable-by-copy in-memory journal behavior;
- deterministic reducer/replay reconstruction;
- single-root stream semantics;
- authoritative candidate event validation before append;
- live/replay equivalence as a control-plane requirement;
- stream identity/idempotency hardening;
- malformed replay failures normalized to the Agent Fabric protocol error domain;
- replay reconstructing accepted control state without rerunning nondeterministic cognition.

### Canonicalization

Accepted for P0a:

- deterministic `forge-canonical-json/v0.1` reference profile;
- SHA-256 digest binding;
- own `__proto__` treated as ordinary data rather than discarded by legacy prototype
  semantics;
- admitted object shape limited to plain/null-prototype enumerable data objects;
- sparse arrays, extra/symbol array properties, accessors, exotic object prototypes and
  non-`Array.prototype` arrays failing closed;
- array normalization reading validated own index descriptor values instead of dispatching
  inherited array methods.

### Public experimental package surface

Accepted:

- package export through `forgeos/agent-fabric`;
- hardened conductor and replay as the public path rather than direct exposure of legacy
  lower-level implementation internals.

## 3. What is explicitly not accepted

P0a acceptance does **not** assert or imply acceptance of:

- P0b or any real nondeterministic model/provider adapter;
- production persistent Agent Fabric journal/storage;
- PGlite production transactionality;
- transactional production outbox semantics;
- real consequential effects;
- effect target resolution or `ResolvedTargetBinding`;
- prepared/authorized/materialized effect chain;
- effect receipts, readback or reconciliation;
- integrity-unknown recovery;
- authority epochs/failover generation semantics;
- production checkpoint/recovery behavior;
- full Adaptive Harness Compiler;
- adaptive model routing;
- production plugin execution/promotion;
- persistent governed memory;
- Evolution Registry implementation;
- full Forge Assurance implementation;
- production deployment readiness;
- production security certification/readiness;
- final cross-language canonicalization/JCS conformance.

No document or later implementation may cite this acceptance record as evidence that any
of those deferred capabilities are already safe, complete, production-ready, or normative.

## 4. Accepted trust assumptions

The acceptance decision is applicable only with these assumptions intact.

### A-TRUST-001 — Trusted journal origin

The authoritative replay prefix is supplied by the trusted journal/storage boundary.
The P0a event hash chain protects content/ordering integrity; it is not an origin signature.

### A-TRUST-002 — Trusted owner verifier

`OwnerAuthorizationVerifier` is trusted to authenticate/admit exact authorization content
and to verify recorded evidence deterministically during replay.

### A-TRUST-003 — Trusted resource definitions

Resource definitions/limits used for authoritative replay are trusted inputs to the replay
context.

### A-TRUST-004 — Trusted semantic control path

Authority-changing control transitions are admitted through the hardened control/replay
path. Bypassing the trusted path is outside the accepted authority model.

### A-TRUST-005 — In-memory proof scope

The accepted P0a persistence/resource transactionality is an in-memory protocol proof.
Production durability requires new evidence rather than extrapolation from P0a.

## 5. Acceptance applicability

This acceptance record applies to:

- the implementation tree of reviewed head `bfd263957…`;
- the same tree as included by merge commit `8972496…`;
- later commits only to the extent they have not changed the accepted Agent Fabric
  semantics without a superseding acceptance decision.

A later refactor that preserves behavior may remain compatible with this acceptance, but a
material change to a frozen invariant, trust boundary, public authority path, event/schema
meaning, canonical representation, or replay semantics requires explicit reassessment.

## 6. Change classification after acceptance

Changes affecting the baseline must be classified before merge.

### Category 1 — editorial/non-semantic

Examples:

- typo fixes;
- broken links;
- formatting;
- comments that do not alter behavior or normative meaning.

These do not require a new acceptance record.

### Category 2 — compatible implementation refinement

Examples:

- internal performance optimization;
- implementation restructuring preserving all frozen invariants;
- additional negative tests;
- diagnostics improvements preserving protocol outcomes.

These require normal CI/review and evidence that frozen invariants remain intact. They may
append evidence without superseding the acceptance record.

### Category 3 — protocol/authority semantic extension

Examples:

- new event type;
- new terminal status;
- change to permit binding;
- change to resource semantics;
- new authority delegation form;
- new canonical data-model acceptance;
- changing replay currentness rules.

These require an explicit new decision/evidence record and applicability analysis.

### Category 4 — new vertical/slice

Examples:

- P0b nondeterministic read-only agent execution;
- production persistence;
- consequential effects;
- recovery epochs;
- persistent memory/evolution.

These require their own acceptance gate and must consume, not silently redefine, the P0a
baseline.

## 7. Acceptance evidence references

Primary repository-native evidence:

- merged implementation: `main@8972496f09727456b8b9f3ceafc386beab5f39d0`;
- exact reviewed parent: `bfd2639579e650d4ad38ec1a81dbd55a5d68865e`;
- P0a implementation documentation: `docs/agent-fabric.md`;
- machine-readable schema: `schemas/agent-fabric/v0.1/control-event.schema.json`;
- source: `src/forge/agent-fabric/**`;
- adversarial/regression tests: `tests/agent-fabric/**`;
- CI workflow run: `34119483414`;
- Security Assurance workflow run: `34119483415`;
- Nuxt Template Smoke workflow run: `34119483465`;
- decision freeze: `S1.0B1_DECISION_FREEZE.md`;
- evidence freeze: `S1.0B2_EVIDENCE_FREEZE.md`.

## 8. Acceptance result

**P0a status:** `ACCEPTED_BASELINE`  
**Merge-blocking findings at accepted head:** `0 BLOCKER / 0 HIGH / 0 MEDIUM`  
**Production-readiness claim:** `NOT MADE`  
**P0b authorization:** `NOT IMPLIED`  
**Architecture supersession:** requires explicit governance record.

## 9. Closure relation to S1.0

This acceptance record, together with S1.0B1 and S1.0B2, is the repository-native bridge
between the executable P0a proof and the next architecture phase.

Once this governance package lands on `main`:

- S1.0B1 Decision Freeze is formally closed;
- S1.0B2 Evidence Freeze is formally closed;
- P0a remains the accepted deterministic protocol baseline;
- S1.1 may be specified from these frozen inputs;
- P0b remains a separate future vertical requiring its own scope and acceptance gate.
