import { describe, expect, test } from "bun:test";
import {
  AgentFabricError, ForgeAgentConductor, MemoryControlJournal, ResourceLedger,
  createRunPlanRevision, applyPlanDelta, digestCanonical, replayControlState, sha256Digest,
  rootGrantAuthorizationViolations, grantAttenuationViolations,
  type ControlEvent, type ControlEventEnvelope, type ExecutionGrant, type OwnerAuthorization,
  type ResourceDefinition,
} from "../../src/forge/agent-fabric/index.ts";
import { childRequest, completeTrace, makeHarness, vectorVerifier, VectorClock } from "./s11-fixtures.ts";

const keys = ["__proto__", "constructor", "toString"];
const semantics = ["consumable", "capacity", "counter"] as const;
function expectCode(fn: () => unknown, code: AgentFabricError["code"]) {
  try { fn(); } catch (error) {
    expect(error).toBeInstanceOf(AgentFabricError);
    expect((error as AgentFabricError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}
function copyJournal(events: readonly ControlEventEnvelope[]) {
  const journal = new MemoryControlJournal();
  for (const event of events) {
    const { sequence, predecessorEventId: _, predecessorEventDigest: __, eventDigest: ___, ...body } = event;
    journal.append({ expectedSequence: sequence - 1, event: body });
  }
  return journal;
}

describe("S12-F02 identifier dictionaries", () => {
  for (const id of Object.getOwnPropertyNames(Object.prototype)) {
    for (const operation of ["authorization", "grant", "consume", "release"] as const) {
      test(`${id}: missing ${operation} rejects live/replay and preserves the next decision`, () => {
        const h = makeHarness();
        const before = h.conductor.state();
        const invoke = () => {
          if (operation === "authorization") return h.conductor.revokeOwnerAuthorization(id, "unknown");
          if (operation === "grant") return h.conductor.revokeGrant(id, "unknown");
          if (operation === "consume") return h.conductor.consumeResourceReservation(id);
          return h.conductor.releaseResourceReservation(id);
        };
        expectCode(invoke, "AF_NOT_FOUND");
        const after = h.conductor.state();
        expect(after.grants).toEqual(before.grants);
        expect(after.revokedAuthorizations).toEqual({});
        expect(after.revokedGrants).toEqual({});
        expect(after.resourceReservations).toEqual({});
        const resourceCall = operation === "consume" || operation === "release";
        expect(after.lastSequence).toBe(before.lastSequence + (resourceCall ? 1 : 0));
        const prefix = h.journal.readAll();
        const payload: ControlEvent = operation === "authorization"
          ? { type: "owner_authorization_revoked", authorizationId: id, reason: "unknown" }
          : operation === "grant" ? { type: "grant_revoked", grantId: id, reason: "unknown" }
          : { type: operation === "consume" ? "resource_reservation_consumed" : "resource_reservation_released", reservationId: id };
        const forged = copyJournal(prefix);
        forged.append({ expectedSequence: prefix.length, event: {
          eventId: "forged:unknown", rootExecutionId: "run:s11", occurredAt: h.clock.now(), payload,
        } });
        expectCode(() => replayControlState(forged.readAll(), h.trust), "AF_INVALID_EVENT");
        const resumedJournal = copyJournal(prefix);
        const resumed = new ForgeAgentConductor("run:s11", resumedJournal, h.clock, sha256Digest,
          vectorVerifier, new ResourceLedger(h.definitions));
        const request = childRequest(h, "after-rejection");
        const live = h.conductor.deriveAndRegisterGrant(h.root.grantId, request);
        expect(live.outcome).toBe("allowed");
        expect(resumed.deriveAndRegisterGrant(h.root.grantId, request)).toEqual(live);
        expect(resumed.state()).toEqual(h.conductor.state());
        expect(resumedJournal.readAll()).toEqual(h.journal.readAll());
      });
    }
  }

  for (const id of keys) {
    test(`${id}: inherited names cannot supply missing authority resource ceilings`, () => {
      const h = makeHarness();
      const resourceCeilings = Object.fromEntries([[id, 1]]);
      const root = { ...h.root, grantId: "new-root", resourceCeilings };
      expect(rootGrantAuthorizationViolations(h.authorization, root)).toContain(`resource_ceiling_expanded:${id}`);
      expectCode(() => h.conductor.registerGrant(root), "AF_GRANT_REJECTED");
      const child = { ...root, parentGrantId: h.root.grantId, delegationDepthRemaining: 2 };
      expect(grantAttenuationViolations(h.root, child)).toContain(`resource_ceiling_expanded:${id}`);
      expect(h.conductor.state().grants).toEqual({ [h.root.grantId]: h.root });
    });
  }

  for (const id of keys) for (const kind of semantics) {
    test(`${id}/${kind}: ledger own keys survive rollback, clone, restore and lifecycle`, () => {
      const definitions: ResourceDefinition[] = [{ resource: id, semantics: kind, limit: 10 }];
      const ledger = new ResourceLedger(definitions);
      expectCode(() => new ResourceLedger([...definitions, ...definitions]), "AF_DUPLICATE_ID");
      const ceilings = Object.fromEntries([[id, 10]]);
      const reservation = ledger.reserve(id, id, [{ resource: id, amount: 1 }], ceilings);
      expect(ledger.reserve(id, id, [{ resource: id, amount: 1 }], ceilings)).toEqual(reservation);
      expectCode(() => ledger.reserve(id, id, [{ resource: id, amount: 2 }], ceilings), "AF_CONFLICT");
      const before = ledger.snapshot();
      expect(Object.hasOwn(before.definitions, id)).toBe(true);
      expect(Object.hasOwn(before.reservations, id)).toBe(true);
      expectCode(() => ledger.reserve("missing-ceiling", id, [{ resource: id, amount: 1 }], {}), "AF_RESOURCE_EXHAUSTED");
      expect(ledger.snapshot()).toEqual(before);
      const sentinel = new Error("append failed");
      expect(() => ledger.transaction(() => { ledger.consume(id); ledger.release(id); throw sentinel; })).toThrow(sentinel);
      expect(ledger.snapshot()).toEqual(before);
      const restored = ResourceLedger.fromSnapshot(structuredClone(before));
      expect(restored.consume(id)).toEqual(ledger.consume(id));
      expect(restored.release(id)).toEqual(ledger.release(id));
      expect(restored.snapshot()).toEqual(ledger.snapshot());
      expect(ledger.snapshot().consumed[id]).toBe(kind === "capacity" ? 0 : 1);
      expect(ledger.snapshot().reserved[id]).toBe(0);
      // Restored nested owner buckets must also accept a later reservation safely.
      expect(restored.reserve("next", id, [{ resource: id, amount: 1 }], ceilings).reservationId).toBe("next");
      expect(Object.hasOwn(Object.prototype, id)).toBe(true);
    });

    test(`${id}/${kind}: registered identifiers remain own data through the complete control path`, () => {
      const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
      const clock = new VectorClock();
      const definitions: ResourceDefinition[] = [{ resource: id, semantics: kind, limit: 10 }];
      const journal = new MemoryControlJournal();
      const conductor = new ForgeAgentConductor(id, journal, clock, sha256Digest, vectorVerifier, new ResourceLedger(definitions));
      const authorization: OwnerAuthorization = {
        authorizationId: id, principalId: id, rootExecutionId: id, goalIds: [id], subjectIds: [id],
        capabilities: [id], sourceIds: [id], targetIds: [id], effectClasses: ["read"], notBefore: 0,
        expiresAt: 10000, maximumAttempts: 100, maximumDelegationDepth: 4,
        resourceCeilings: Object.fromEntries([[id, 10]]),
      };
      conductor.registerOwnerAuthorization(authorization);
      conductor.registerGoal({ goalId: id, revision: 1, authorityInvocationId: id, objectives: ["test"],
        nonObjectives: [], acceptanceCriteria: ["replay"], allowedEffectClasses: ["read"],
        prohibitedEffectClasses: ["consequential"], sourceBoundary: { sourceIds: [id], allowExpansion: false } });
      const root: ExecutionGrant = { grantId: id, rootAuthorizationId: id, subjectId: id, parentGrantId: null,
        capabilities: [id], sourceIds: [id], targetIds: [id], effectClasses: ["read"], notBefore: 0,
        expiresAt: 10000, maximumAttempts: 50, delegationDepthRemaining: 3,
        resourceCeilings: Object.fromEntries([[id, 10]]),
      };
      conductor.registerGrant(root);
      const child = conductor.deriveAndRegisterGrant(id, { grantId: "child", subjectId: id,
        capabilities: [id], sourceIds: [id], targetIds: [id], effectClasses: ["read"], notBefore: 1000,
        expiresAt: 9000, maximumAttempts: 5, delegationDepthRemaining: 2, reservationId: id,
        resourceRequests: [{ resource: id, amount: 0.5 }, { resource: id, amount: 0.5 }],
      });
      expect(child.outcome).toBe("allowed");
      const revision = createRunPlanRevision(id, id, { programId: id, version: 1, nodes: [
        { nodeId: id, kind: "activity", dependsOn: [], agentSpecId: id, harnessSpecId: id, executionProfileId: id },
      ] }, id, sha256Digest);
      conductor.activatePlan(revision, null);
      conductor.commitDispatchIntent({ intentId: id, rootExecutionId: id, planRevisionId: id, taskNodeId: id,
        effectiveRunSpecDigest: sha256Digest("spec"), sourceIds: [id], targetId: id,
        requiredCapability: id, effectClass: "read", createdAt: clock.now() });
      conductor.claimDispatch({ claimId: id, intentId: id, workerId: id, attemptId: id, leaseDurationMs: 500 });
      const permit = conductor.issuePermit({ permitId: id, claimId: id, grantId: "child", maximumValidityMs: 400 });
      conductor.authorizeAttemptDispatch(permit);
      conductor.acceptStartupReport(permit, { startupReportId: id, attemptId: id,
        observedSpecDigest: permit.effectiveRunSpecDigest, startedAt: clock.now() });
      conductor.recordAttemptUncertainty(permit, "outcome", "pending");
      conductor.commitOutcome({ reportId: id, attemptId: id, permitId: id, intentId: id, planRevisionId: id,
        effectiveRunSpecDigest: permit.effectiveRunSpecDigest, fencingToken: permit.fencingToken,
        status: "succeeded", resultDigest: sha256Digest("result"), evidenceDigests: [], reportedAt: clock.now() });
      conductor.consumeResourceReservation(id);
      conductor.releaseResourceReservation(id);
      const delta = { deltaId: id, rootExecutionId: id, baseRevisionId: id, nextRevisionId: "next-plan", operations: [] };
      conductor.registerPlanDelta(delta);
      conductor.activatePlan(applyPlanDelta(revision, delta, sha256Digest), id);
      conductor.revokeGrant(id, "done");
      conductor.revokeOwnerAuthorization(id, "done");
      const state = conductor.state();
      for (const record of [state.authorizations, state.authorizationVerifications, state.revokedAuthorizations,
        state.goals, state.grants, state.revokedGrants, state.resourceDefinitions, state.resourceReservations,
        state.resourceOwnerReserved, state.resourceOwnerConsumed, state.planDeltas, state.planRevisions,
        state.activePlanRevisionByExecution, state.dispatchIntents, state.claims, state.activeClaimByIntent,
        state.claimByAttemptId, state.permits, state.attempts, state.outcomes]) {
        expect(Object.hasOwn(record, id)).toBe(true);
      }
      const trust = { ownerAuthorizationVerifier: vectorVerifier, resourceDefinitions: definitions };
      expect(replayControlState(structuredClone(journal.readAll()), trust)).toEqual(state);
      const resumed = new ForgeAgentConductor(id, copyJournal(journal.readAll()), clock, sha256Digest,
        vectorVerifier, new ResourceLedger(definitions));
      expect(resumed.state()).toEqual(state);
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore);
    });
  }

  test("ordinary accepted trace keeps its baseline canonical bytes", () => {
    const h = completeTrace();
    expect(digestCanonical(h.journal.readAll(), sha256Digest)).toBe("sha256:3324a6aa9bffb5e339c75e14918e29a4cf167d1d9b3880735b84800072a4483b");
    expect(digestCanonical(h.conductor.state(), sha256Digest)).toBe("sha256:5b62cffbda38d7eb67f30a890933df77798307be3275f80854d78b1cbd28d470");
  });
});
