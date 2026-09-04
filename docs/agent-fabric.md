# Forge Agent Fabric

Forge Agent Fabric is an experimental protocol-oriented execution layer for dynamically materialized agents and workflows. It extends Forge's existing compiler, outbox, actions, workflows, policy, and agent runtime rather than replacing them.

## Implementation status

**Only the deterministic P0a protocol kernel is implemented in this branch.**

The following remain explicitly deferred and must not be inferred from architecture notes, historical handoffs, or local experiments:

- a real non-deterministic P0b model adapter;
- PGlite-backed production persistence/outbox integration for Agent Fabric;
- consequential-effect brokers and reconciliation against real systems;
- recovery epochs and integrity-unknown recovery;
- adaptive model routing/harness compilation beyond the P0a contracts;
- plugin promotion, persistent memory, and governed self-evolution;
- production deployment or production security claims.

## P0a scope

The first vertical implements a deterministic control kernel with:

- explicit `OwnerAuthorization`, `GoalContract`, `RunPlanRevision`, `PlanDelta`, `AgentSpec`, `HarnessSpec`, `ExecutionProfile`, and `EffectiveRunSpec` contracts;
- an immutable-by-copy control journal with sequence, predecessor, digest chain, and deterministic reducer;
- owner authorization ingress through an injected verifier, with content-bound verification evidence recorded in the journal and revalidated during replay;
- root grants bound to an explicit verified owner authorization;
- child grants with monotonic attenuation and transitive revocation;
- resource reservation plus child-grant registration as one in-memory transactional operation;
- replay-side reconstruction of consumable, capacity, and counter accounting from trusted resource definitions and journaled reservation transitions;
- globally unique attempt identities and one claim lineage per attempt;
- durable dispatch intent, non-authoritative offers, atomic claims, leases, fencing, and attempt-bound permits;
- deterministic adapter protocol behavior;
- worker result reports bound to permit, intent, plan revision, `EffectiveRunSpec`, and fencing generation;
- authoritative `succeeded | failed` outcome commit that preserves result-report provenance and rejects stale or revoked ancestry;
- late `AttemptUncertaintyObservation` evidence that does **not** become a terminal authoritative outcome and therefore does not by itself block retry;
- plan revisions that preserve `GoalContract` and workflow program identity and are exactly derivable from a registered `PlanDelta`;
- runtime event validation and a closed JSON Schema envelope/payload model;
- crash/replay reconstruction without re-running a planner.

P0a intentionally does not implement external effects, persistent memory, model routing, plugin promotion, or production deployment.

## Authority model

A workflow may choose how to work, but it may not create authority. The reference Conductor requires an `OwnerAuthorizationVerifier` before it can admit an `OwnerAuthorization`. The verification result is content-bound to the authorization digest and the replay path requires a trust-bound verifier to validate the recorded evidence again.

Root grants must remain within that authorization. Child grants must be strict subsets of their parent and remain invalid if:

- any ancestor is revoked or expired;
- the root authorization is revoked or expired;
- the child reservation is missing or has been released.

```text
authenticated owner authorization
  -> trusted ingress verification
  -> root execution grant
  -> derived child grant + resource reservation
  -> dispatch intent
  -> dispatch offer (not authority)
  -> scheduling claim + lease + fencing
  -> attempt execution permit
  -> executor startup report
  -> worker result report
  -> conditional authoritative succeeded|failed outcome commit
```

The concrete production identity provider, signature/trust-root mechanism, and credential lifecycle are deliberately outside P0a; the kernel only requires a verifier contract with deterministic/offline verification of recorded admission evidence.

## Attempt identity and result binding

`attemptId` is a stream-global identity, not merely a caller convenience. A second claim may not reuse an existing attempt ID, even for another intent.

A `WorkerResultReport` is explicitly bound to:

- `attemptId`;
- `permitId`;
- `intentId`;
- `planRevisionId`;
- `effectiveRunSpecDigest`;
- `fencingToken`.

The report digest covers those fields as well as status, result digest, evidence digests and report time. `commitOutcome()` compares the report against the persisted permit/claim/intent lineage before it can become authoritative.

## Resource atomicity and replay

P0a uses `ResourceLedger.transaction()` to make reservation and child-grant journal registration atomic within the in-memory reference implementation. If journal registration fails, the ledger snapshot is restored, including consumable, capacity, and counter state.

The replay path does not accept a reservation merely because its shape matches a child grant. Resource definitions and limits are supplied through the replay trust context; reservation transitions are reapplied to reconstructed global/owner accounting. Duplicate resources, unknown resources, invalid transitions, or aggregate global overcommit fail closed.

Reservation `consume` and `release` operations have journaled transitions when performed through the Conductor. Releasing the reservation backing a derived grant makes that grant lineage non-current for future permits/startups/outcomes.

This remains an in-memory protocol proof. A later persistence slice must implement the same atomicity and journal coupling with a real transactional store/outbox.

## Uncertainty is not an authoritative outcome

P0a deliberately separates:

```text
AttemptUncertaintyObservation
!=
AuthoritativeOutcomeCommit
```

A late worker/adapter observation may say that startup or completion is uncertain even after a lease, permit, plan or grant has become stale. The observation is retained as evidence, but it does not make the intent terminal and cannot by itself block a later scheduling claim.

Only a currently authorized control path may commit a terminal P0a outcome, and P0a terminal outcomes are limited to `succeeded | failed`.

## Replay model and trust boundary

`MemoryControlJournal` stores cloned/frozen events and returns clones to callers. Every committed envelope carries:

- monotonic sequence;
- predecessor event ID;
- predecessor event digest;
- event digest;
- monotonic authoritative timestamp.

`replayControlState()` revalidates:

- the digest chain and event shape;
- trusted owner-authorization evidence;
- grant ancestry and revocation;
- resource accounting against trust-bound definitions;
- global attempt/resource budgets;
- globally unique attempt identity;
- exact plan-delta lineage;
- claims, permits, startup and authoritative outcome bindings.

The event hash chain is an **integrity mechanism, not a signature or proof of storage origin**. P0a assumes the journal prefix supplied for authoritative replay comes from the trusted journal/storage boundary. The reducer determines whether that prefix is semantically admissible; production durable storage/authentication of journal bytes is intentionally deferred to the persistence slice.

This distinction is important: arbitrary attacker-created bytes do not become authoritative merely because they form a self-consistent hash chain.

## Canonicalization scope

P0a currently uses `forge-canonical-json/v0.1`, a deterministic TypeScript/JavaScript reference profile with SHA-256. It is **not** claimed to be the final cross-language canonicalization standard. A future protocol revision must adopt a cross-language profile (for example RFC 8785/JCS or an equivalently specified profile) with shared test vectors before Java/Python/Rust implementations are expected to produce identical digests.

## Public API

The experimental API is exported from:

```ts
import {
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  DeterministicTestAdapter,
} from "forgeos/agent-fabric";
```
