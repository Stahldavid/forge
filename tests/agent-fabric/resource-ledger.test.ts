import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  AgentFabricError,
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  deriveExecutionGrant,
  type Digest,
  type ExecutionGrant,
} from "../../src/forge/agent-fabric/index.ts";

function digest(value: string): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

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
    const ledger = new ResourceLedger([
      { resource: "modelCalls", semantics: "consumable", limit: 10 },
    ]);
    const parent = parentGrant();

    expect(deriveExecutionGrant(parent, childRequest("one", 3), ledger, 0).outcome).toBe(
      "allowed",
    );
    expect(deriveExecutionGrant(parent, childRequest("two", 2), ledger, 0).outcome).toBe(
      "rejected",
    );
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

  test("rejects forged or cumulatively oversized derived grants at journal admission", () => {
    const conductor = new ForgeAgentConductor(
      "run:authority",
      new MemoryControlJournal(),
      { now: () => 0 },
      digest,
    );
    const parent = parentGrant();
    conductor.registerGrant(parent);
    conductor.registerGrant({
      ...parent,
      grantId: "grant:child:one",
      subjectId: "worker:one",
      parentGrantId: parent.grantId,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      resourceCeilings: { modelCalls: 3 },
      reservationId: "reservation:child:one",
    });

    expect(() => conductor.registerGrant({
      ...parent,
      grantId: "grant:child:two",
      subjectId: "worker:two",
      parentGrantId: parent.grantId,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      resourceCeilings: { modelCalls: 2 },
      reservationId: "reservation:child:two",
    })).toThrow(AgentFabricError);

    expect(() => conductor.registerGrant({
      ...parent,
      grantId: "grant:child:forged",
      rootAuthorizationId: "auth:attacker",
      subjectId: "worker:forged",
      parentGrantId: parent.grantId,
      maximumAttempts: 1,
      delegationDepthRemaining: 1,
      resourceCeilings: { modelCalls: 1 },
      reservationId: "reservation:child:forged",
    })).toThrow(AgentFabricError);
  });
});
