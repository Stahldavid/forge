# Workflow program v2 implementation decisions

Date: 2026-10-07. Scope: opt-in alpha foundation, additive to the existing v1 runtime.
The user's implementation/release instruction authorizes this code release. Earlier
historical adoption records and their acceptance claims retain their original scope.

1. The canonical program is a finite typed JSON IR. TypeScript is statically lowered
   using a restricted AST; the owner never executes authored source. This combines
   convenient script-like authoring with inspectable bounded orchestration.
2. Schemas, executors, policies, acceptance and population are trusted owner registries.
   Requests select references and cannot lower their own review or effect authority.
   Static inference is conservative; runtime validation remains mandatory.
3. The current local project owner hosts v1 and v2. A checksummed atomic record commits
   decisions and immutable artifacts, including full historical stateRefs. Recovery
   observes uncertainty before explicit resume. No power-loss or external exactly-once
   durability claim is made.
4. Discovery seals identity and coverage against an owner inventory. Accepted work has
   a separate collection ledger linking assessments and contributions to the final
   candidate. File inventory is implemented; semantic inventory adapters remain separate.
5. Repair is a finite built-in state machine with independent implementation,
   assessment and infrastructure budgets. Rejection or uncertainty stops consumers.
   Candidates preserve parents, producers and ordered deltas; equal independent patches
   conflict, and shared ancestry is applied once.
6. Only owner-issued gates authorize a candidate. ApplyIntent freezes the complete
   decision before writes. Local multi-file application is observable and reconciled,
   not one filesystem transaction. Partial application never retries automatically.
7. Barrier, additive and opt-in fenced replanning preserve history and generations.
   Fenced replanning uses a global scheduling barrier. Independent live branch
   replacement is deferred until a scheduler can enforce each branch's full closure.
8. Reuse defaults off. Declared command workspace caches require attested inputs.
   SDK output cache remains disabled until instructions/plugins/model inputs are closed.
   Commands are cooperative host processes; strong sandbox claims are rejected for them.
9. Initial authoring/runtime budgets are finite. A shared capacity wait rechecks the
   count after waking. Maximum-scale performance and archive/GC are not established.
10. The procedural benchmark is labelled as a reference scheduler, not Claude Code.
    Real SDK proof is a readonly typed activity. Full coding quality, integration
    acceptance, production delivery and product superiority require additional evidence.

See [the executable contract](../../agent-fabric-programs.md),
[reviewed design plan](WORKFLOW_PROGRAM_V2_PLAN.md) and
[verification evidence](WORKFLOW_PROGRAM_V2_EVIDENCE.md).
