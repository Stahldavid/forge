import { describe, expect, test } from "bun:test";
import { AgentFabricError, sha256Digest } from "../../src/forge/agent-fabric/index.ts";
import { makeHarness } from "./s11-fixtures.ts";

function expectCode(fn: () => unknown, code: AgentFabricError["code"]): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentFabricError);
    expect((error as AgentFabricError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("S13-GAP-001 dispatch offer own-key intent lookup", () => {
  for (const intentId of Object.getOwnPropertyNames(Object.prototype)) {
    test(`${intentId}: inherited-only name does not satisfy dispatch intent lookup`, () => {
      const h = makeHarness();
      const beforeState = h.conductor.state();
      const beforeEvents = h.journal.readAll();

      expectCode(
        () => h.conductor.createDispatchOffer(intentId, "pool:s13-gap-001", `offer:missing:${intentId}`, h.clock.now() + 100),
        "AF_NOT_FOUND",
      );

      expect(h.conductor.state()).toEqual(beforeState);
      expect(h.journal.readAll()).toEqual(beforeEvents);
      expect(Object.hasOwn(h.conductor.state().dispatchIntents, intentId)).toBe(false);
    });

    test(`${intentId}: registered own intent remains offerable and the offer is nonpersisting`, () => {
      const h = makeHarness();
      const intent = {
        intentId,
        rootExecutionId: "run:s11",
        planRevisionId: h.revision.revisionId,
        taskNodeId: "node:s11",
        effectiveRunSpecDigest: sha256Digest(`spec:s13-gap-001:${intentId}`),
        sourceIds: ["source:s11"],
        targetId: "target:s11",
        requiredCapability: "read",
        effectClass: "read" as const,
        createdAt: h.clock.now(),
      };
      h.conductor.commitDispatchIntent(intent);

      const beforeOfferEvents = h.journal.readAll().length;
      const offer = h.conductor.createDispatchOffer(
        intentId,
        "pool:s13-gap-001",
        `offer:own:${intentId}`,
        h.clock.now() + 100,
      );

      expect(Object.hasOwn(h.conductor.state().dispatchIntents, intentId)).toBe(true);
      expect(h.conductor.state().dispatchIntents[intentId]).toEqual(intent);
      expect(offer).toEqual({
        offerId: `offer:own:${intentId}`,
        intentId,
        audiencePool: "pool:s13-gap-001",
        expiresAt: h.clock.now() + 100,
        nonAuthoritative: true,
      });
      expect(h.journal.readAll()).toHaveLength(beforeOfferEvents);
    });
  }
});
