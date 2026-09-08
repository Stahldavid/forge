import { describe, expect, test } from "bun:test";
import { ResourceLedger, deriveExecutionGrant, type ExecutionGrant } from "../../src/forge/agent-fabric/index.ts";

function parentGrant(): ExecutionGrant {
  return {
    grantId: "grant:parent",
    rootAuthorizationId: "auth:owner:1",
    subjectId: "conductor",
    parentGrantId: null,
    capabilities: ["architecture.read"],
    sourceIds: ["source:forge"],
    targetIds: ["target:artifact-store"],
    effectClasses: ["read"],
    notBefore: 0,
    expiresAt: 10_000,
    maximumAttempts: 2,
    delegationDepthRemaining: 2,
    resourceCeilings: { modelCalls: 4 },
  };
}

function childRequest(id: string, amount: number) {
  return {
    grantId: `grant:${id}`,
    subjectId: `worker:${id}`,
    capabilities: ["architecture.read"] as const,
    sourceIds: ["source:forge"] as const,
    targetIds: ["target:artifact-store"] as const,
    effectClasses: ["read"] as const,
    notBefore: 0,
    expiresAt: 1_000,
    maximumAttempts: 1,
    delegationDepthRemaining: 1,
    reservationId: `reservation:${id}`,
    resourceRequests: [{ resource: "modelCalls", amount }],
  };
}

describe("Agent Fabric resource accounting", () => {
  test("conserves a parent ceiling across multiple children", () => {
    const ledger = new ResourceLedger([{ resource: "modelCalls", semantics: "consumable", limit: 10 }]);
    const parent = parentGrant();
    expect(deriveExecutionGrant(parent, childRequest("one", 3), ledger, 0).outcome).toBe("allowed");
    expect(deriveExecutionGrant(parent, childRequest("two", 2), ledger, 0).outcome).toBe("rejected");
  });

  test("normalizes equivalent reservation requests before idempotency comparison", () => {
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 10 },
      { resource: "workers", semantics: "capacity", limit: 2 },
    ]);
    const first = ledger.reserve("reservation:one", "grant:parent", [
      { resource: "workers", amount: 1 },
      { resource: "modelCalls", amount: 1 },
      { resource: "modelCalls", amount: 2 },
    ]);
    const duplicate = ledger.reserve("reservation:one", "grant:parent", [
      { resource: "modelCalls", amount: 3 },
      { resource: "workers", amount: 1 },
    ]);
    expect(duplicate).toEqual(first);
    expect(ledger.snapshot().reserved).toEqual({ modelCalls: 3, workers: 1 });
  });

  test("transaction restores consumable, capacity, and counter state after failure", () => {
    const ledger = new ResourceLedger([
      { resource: "calls", semantics: "consumable", limit: 5 },
      { resource: "workers", semantics: "capacity", limit: 2 },
      { resource: "attempts", semantics: "counter", limit: 5 },
    ]);
    const before = ledger.snapshot();
    expect(() => ledger.transaction(() => {
      ledger.reserve("reservation:tx", "owner", [
        { resource: "calls", amount: 2 },
        { resource: "workers", amount: 1 },
        { resource: "attempts", amount: 1 },
      ]);
      throw new Error("rollback");
    })).toThrow();
    expect(ledger.snapshot()).toEqual(before);
  });
});
