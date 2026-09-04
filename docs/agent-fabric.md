# Forge Agent Fabric

Forge Agent Fabric is an experimental protocol-oriented execution layer for dynamically materialized agents and workflows. It extends Forge's existing compiler, outbox, actions, workflows, policy, and agent runtime rather than replacing them.

## P0a scope

The first vertical implements a deterministic control kernel with:

- explicit `GoalContract`, `RunPlanRevision`, `PlanDelta`, `AgentSpec`, `HarnessSpec`, `ExecutionProfile`, and `EffectiveRunSpec` contracts;
- an append-only control journal and deterministic reducer;
- execution grants with monotonic attenuation;
- atomic resource reservations across child grants;
- durable dispatch intent, non-authoritative offers, atomic claims, leases, fencing, and attempt-bound permits;
- deterministic adapter protocol behavior;
- authoritative outcome commit that rejects stale workers;
- crash/replay reconstruction without re-running a planner.

P0a intentionally does not implement external effects, persistent memory, model routing, plugin promotion, or production deployment.

## Authority model

A workflow may choose how to work, but it may not create authority. Child grants must be strict subsets of their parent grant and share a resource ledger that prevents aggregate oversubscription.

```text
owner authorization
  -> execution grant
  -> dispatch intent
  -> dispatch offer (not authority)
  -> scheduling claim + lease + fencing
  -> attempt execution permit
  -> worker result report
  -> conditional authoritative outcome commit
```

## Replay model

`MemoryControlJournal` provides the P0a reference implementation. Every event has a sequence and predecessor. `replayControlState()` rejects gaps and invalid predecessors and reconstructs control state without invoking an LLM or planner.

The in-memory implementation is a protocol proof, not the production durability backend. A later slice will bind the same contracts to Forge's database and outbox infrastructure.

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
