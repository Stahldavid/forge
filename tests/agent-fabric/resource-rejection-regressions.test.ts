import { describe, expect, test } from "bun:test";
import {
  AgentFabricError, ForgeAgentConductor, MemoryControlJournal, ResourceLedger, sha256Digest,
} from "../../src/forge/agent-fabric/index.ts";
import { childRequest, makeHarness, vectorVerifier } from "./s11-fixtures.ts";

function expectResourceExhausted(operation: () => unknown): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AgentFabricError);
    expect((error as AgentFabricError).code).toBe("AF_RESOURCE_EXHAUSTED");
    return;
  }
  throw new Error("Expected resource exhaustion");
}

const rejectionCases: {
  name: string;
  limit: number;
  ownerCeilings: Record<string, number>;
}[] = [
  { name: "global limit", limit: 1, ownerCeilings: { units: 10 } },
  { name: "owner ceiling", limit: 10, ownerCeilings: { units: 1 } },
  { name: "missing owner ceiling", limit: 10, ownerCeilings: {} },
];

describe("S12-F01 resource rejection atomicity", () => {
  for (const semantics of ["consumable", "capacity", "counter"] as const) {
    for (const scenario of rejectionCases) {
      test(`${semantics}: first-owner ${scenario.name} rejection preserves the complete snapshot`, () => {
        const ledger = new ResourceLedger([{ resource: "units", semantics, limit: scenario.limit }]);
        const before = ledger.snapshot();
        expectResourceExhausted(() => ledger.reserve(
          "reservation:first", "owner:first", [{ resource: "units", amount: 2 }], scenario.ownerCeilings,
        ));
        expect(ledger.snapshot()).toEqual(before);

        const valid = ledger.reserve(
          "reservation:first", "owner:first", [{ resource: "units", amount: 1 }], { units: 1 },
        );
        expect(valid.requests).toEqual([{ resource: "units", amount: 1 }]);
        expect(valid.status).toBe(semantics === "counter" ? "consumed" : "active");
      });
    }

    test(`${semantics}: rejecting a later resource preserves all earlier totals and owner maps`, () => {
      const ledger = new ResourceLedger([
        { resource: "first", semantics, limit: 1 },
        { resource: "second", semantics, limit: 1 },
      ]);
      const before = ledger.snapshot();
      expectResourceExhausted(() => ledger.reserve("reservation:multi", "owner:multi", [
        { resource: "first", amount: 1 },
        { resource: "second", amount: 2 },
      ], { first: 10, second: 10 }));
      expect(ledger.snapshot()).toEqual(before);
    });

    test(`${semantics}: live and resumed conductors allow the same next grant after first rejection`, () => {
      const h = makeHarness({ definitions: [{ resource: "units", semantics, limit: 1 }] });
      const before = h.conductor.state();
      const seedBefore = h.seed.snapshot();
      const rejected = h.conductor.deriveAndRegisterGrant(h.root.grantId, {
        ...childRequest(h, "too-large"), resourceRequests: [{ resource: "units", amount: 2 }],
      });
      expect(rejected).toEqual({
        outcome: "rejected", reasonCodes: ["af_resource_exhausted"], limitations: [],
      });
      const afterRejection = h.conductor.state();
      expect(afterRejection.lastSequence).toBe(before.lastSequence + 1);
      expect(h.journal.readAll().at(-1)?.payload.type).toBe("resource_ledger_initialized");
      expect(afterRejection.grants).toEqual(before.grants);
      expect(afterRejection.resourceReservations).toEqual({});
      expect(afterRejection.resourceOwnerReserved).toEqual({});
      expect(afterRejection.resourceOwnerConsumed).toEqual({});
      expect(h.seed.snapshot()).toEqual(seedBefore);

      // Independent journals prevent one conductor's next append affecting the other.
      const resumedJournal = new MemoryControlJournal();
      for (const envelope of h.journal.readAll()) {
        const { sequence, predecessorEventId: _, predecessorEventDigest: __, eventDigest: ___, ...event } = envelope;
        resumedJournal.append({ expectedSequence: sequence - 1, event });
      }
      const resumed = new ForgeAgentConductor(
        "run:s11", resumedJournal, h.clock, sha256Digest, vectorVerifier, new ResourceLedger(h.definitions),
      );
      expect(resumed.state()).toEqual(afterRejection);

      const request = childRequest(h, "valid");
      const liveResult = h.conductor.deriveAndRegisterGrant(h.root.grantId, request);
      const resumedResult = resumed.deriveAndRegisterGrant(h.root.grantId, request);
      expect(liveResult.outcome).toBe("allowed");
      expect(resumedResult).toEqual(liveResult);
      expect(resumed.state()).toEqual(h.conductor.state());
      expect(resumedJournal.readAll()).toEqual(h.journal.readAll());
      expect(h.conductor.state().lastSequence).toBe(afterRejection.lastSequence + 1);
    });
  }
});
