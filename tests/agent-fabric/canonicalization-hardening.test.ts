import { describe, expect, test } from "bun:test";
import {
  AgentFabricError,
  digestCanonical,
  replayControlState,
  sha256Digest,
  stableStringify,
  type ControlEventEnvelope,
  type OwnerAuthorizationVerifier,
} from "../../src/forge/agent-fabric/index.ts";

const verifier: OwnerAuthorizationVerifier = {
  verify(_authorization, authorizationDigest) {
    return {
      verifierId: "canonicalization-test/v1",
      authorizationDigest,
      evidenceDigest: sha256Digest("canonicalization-test-evidence"),
    };
  },
  verifyRecorded() {
    return true;
  },
};

describe("P0a canonicalization hardening", () => {
  test("an own __proto__ property is preserved as canonical data and changes the digest", () => {
    const withoutProto = {
      authorizationId: "auth:1",
      resourceCeilings: {},
    };
    const withProto = {
      authorizationId: "auth:1",
      resourceCeilings: JSON.parse('{"__proto__":1}') as Record<string, number>,
    };

    const canonical = stableStringify(withProto);
    expect(canonical).toContain('"__proto__":1');
    expect(Object.prototype.hasOwnProperty.call(withProto.resourceCeilings, "__proto__")).toBe(true);
    expect(digestCanonical(withProto, sha256Digest)).not.toBe(
      digestCanonical(withoutProto, sha256Digest),
    );
  });

  test("arrays with non-JSON own properties are rejected instead of colliding", () => {
    const array = ["a"] as string[] & { hidden?: string };
    array.hidden = "different-content";
    expect(() => stableStringify(array)).toThrow(AgentFabricError);
  });

  test("sparse arrays are rejected instead of canonicalizing like explicit null", () => {
    const sparse = new Array(1);
    expect(() => stableStringify(sparse)).toThrow(AgentFabricError);
    expect(stableStringify([null])).toBe("[null]");
  });

  test("arrays with exotic prototypes fail closed instead of dispatching inherited map", () => {
    const first = [1];
    const second = [2];
    const maliciousPrototype = {
      map() {
        return [];
      },
    };
    Object.setPrototypeOf(first, maliciousPrototype);
    Object.setPrototypeOf(second, maliciousPrototype);

    expect(Array.isArray(first)).toBe(true);
    expect(Array.isArray(second)).toBe(true);
    expect(() => stableStringify(first)).toThrow(AgentFabricError);
    expect(() => stableStringify(second)).toThrow(AgentFabricError);
  });

  test("arrays with null prototype fail as AgentFabricError rather than TypeError", () => {
    const value = [1];
    Object.setPrototypeOf(value, null);

    try {
      stableStringify(value);
      throw new Error("expected exotic array prototype to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFabricError);
      expect((error as AgentFabricError).code).toBe("AF_CANONICALIZATION_FAILED");
      expect(error).not.toBeInstanceOf(TypeError);
    }
  });

  test("malformed replay input is normalized to AgentFabricError rather than TypeError", () => {
    const malformed: ControlEventEnvelope = {
      eventId: "event:malformed",
      rootExecutionId: "run:malformed",
      occurredAt: 1,
      idempotencyKey: "malformed",
      payload: null as never,
      sequence: 1,
      predecessorEventId: null,
      predecessorEventDigest: null,
      eventDigest: sha256Digest("not-relevant-before-structural-rejection"),
    };

    try {
      replayControlState([malformed], { ownerAuthorizationVerifier: verifier });
      throw new Error("expected replay to reject malformed input");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentFabricError);
      expect((error as AgentFabricError).code).toBe("AF_INVALID_EVENT");
      expect(error).not.toBeInstanceOf(TypeError);
    }
  });
});
