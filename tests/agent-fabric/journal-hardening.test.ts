import { describe, expect, test } from "bun:test";
import { AgentFabricError, MemoryControlJournal, replayControlState } from "../../src/forge/agent-fabric/index.ts";

function validGoalEvent(): Parameters<MemoryControlJournal["append"]>[0] {
  return {
    expectedSequence: 0,
    event: {
      eventId: "event:authorization",
      rootExecutionId: "run:1",
      occurredAt: 1,
      payload: {
        type: "owner_authorization_registered" as const,
        authorization: {
          authorizationId: "auth:1",
          principalId: "owner:1",
          rootExecutionId: "run:1",
          goalIds: ["goal:1"],
          subjectIds: ["worker:1"],
          capabilities: ["read"],
          sourceIds: ["source:1"],
          targetIds: ["target:1"],
          effectClasses: ["read" as const],
          notBefore: 0,
          expiresAt: 100,
          maximumAttempts: 1,
          maximumDelegationDepth: 0,
          resourceCeilings: { calls: 1 },
        },
        verification: {
          verifierId: "test-owner-verifier/v1",
          authorizationDigest: "sha256:df13e6adfdc5cff0f88c2dc7f9912a44a17305a2b30ef0c9aed46784b06547d6",
          evidenceDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
    },
  };
}

describe("MemoryControlJournal hardening", () => {
  test("mutating input or returned envelope cannot alter stored history", () => {
    const journal = new MemoryControlJournal();
    const input = validGoalEvent();
    const appended = journal.append(input);
    input.event.eventId = "event:mutated";
    if (input.event.payload.type !== "owner_authorization_registered") throw new Error("unexpected event");
    input.event.payload.authorization.principalId = "attacker";
    appended.eventId = "event:return-mutated";
    if (appended.payload.type === "owner_authorization_registered") {
      appended.payload.authorization.principalId = "attacker:2";
    }
    const [stored] = journal.readAll();
    expect(stored?.eventId).toBe("event:authorization");
    if (stored?.payload.type !== "owner_authorization_registered") throw new Error("unexpected event");
    expect(stored.payload.authorization.principalId).toBe("owner:1");
    expect(() => replayControlState(journal.readAll())).not.toThrow();
  });

  test("rejects runtime payloads with unknown fields", () => {
    const journal = new MemoryControlJournal();
    const invalid = validGoalEvent() as any;
    invalid.event.payload.authorization.unexpected = true;
    expect(() => journal.append(invalid)).toThrow(AgentFabricError);
  });

  test("rejects non-monotonic journal timestamps", () => {
    const journal = new MemoryControlJournal();
    journal.append(validGoalEvent());
    expect(() => journal.append({
      expectedSequence: 1,
      event: {
        eventId: "event:revoke",
        rootExecutionId: "run:1",
        occurredAt: 0,
        payload: { type: "owner_authorization_revoked", authorizationId: "auth:1", reason: "test" },
      },
    })).toThrow(AgentFabricError);
  });
});
