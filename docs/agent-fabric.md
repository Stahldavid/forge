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
- owner authorization ingress through an injected verifier, with content-bound verification evidence recorded in the journal;
- root grants bound to an explicit verified owner authorization;
- child grants with monotonic attenuation and transitive revocation;
- resource reservation plus child-grant registration as one in-memory transactional operation;
- durable dispatch intent, non-authoritative offers, atomic claims, leases, fencing, and attempt-bound permits;
- deterministic adapter protocol behavior;
- authoritative outcome commit that preserves result-report provenance and rejects stale or revoked ancestry;
- plan revisions that preserve `GoalContract` and workflow program identity and are exactly derivable from a registered `PlanDelta`;
- runtime event validation and a closed JSON Schema envelope/payload model;
- crash/replay reconstruction without re-running a planner.

P0a intentionally does not implement external effects, persistent memory, model routing, plugin promotion, or production deployment.

## Authority model

A workflow may choose how to work, but it may not create authority. The reference Conductor requires an `OwnerAuthorizationVerifier` before it can admit an `OwnerAuthorization`. The verification result is content-bound to the authorization digest. Root grants must then remain within that authorization; child grants must be strict subsets of their parent and remain invalid if any ancestor or root authorization is revoked or expired.

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
  -> conditional authoritative outcome commit
```

The concrete production identity provider, signature/trust-root mechanism, and credential lifecycle are deliberately outside P0a; the kernel only requires that a trusted verifier supply content-bound admission evidence rather than allowing a root grant to self-authorize.

## Resource atomicity

P0a uses `ResourceLedger.transaction()` to make reservation and child-grant journal registration atomic within the in-memory reference implementation. If journal registration fails, the ledger snapshot is restored, including consumable, capacity, and counter state.

This is an in-memory protocol proof. A later persistence slice must implement the same invariant with a real transactional store/outbox rather than treating this reference mechanism as production durability.

## Replay model

`MemoryControlJournal` stores cloned/frozen events and returns clones to callers. Every committed envelope carries:

- monotonic sequence;
- predecessor event ID;
- predecessor event digest;
- event digest;
- monotonic authoritative timestamp.

`replayControlState()` revalidates the digest chain, authority ancestry, authorization content binding, exact plan-delta lineage, timestamps, and authority-sensitive transitions. It reconstructs control state without invoking an LLM or planner.

## Canonicalization scope

P0a currently uses `forge-canonical-json/v0.1`, a deterministic TypeScript/JavaScript reference profile. It is **not** claimed to be the final cross-language canonicalization standard. A future protocol revision must adopt a cross-language profile (for example RFC 8785/JCS or an equivalently specified profile) with shared test vectors before Java/Python/Rust implementations are expected to produce identical digests.

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
