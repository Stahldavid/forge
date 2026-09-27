import { describe, expect, test } from "bun:test";
import { AgentFabricError } from "../../src/forge/agent-fabric/errors.ts";
import { validateLocalCodingTaskProposal } from "../../src/forge/agent-fabric/local-task-contract.ts";

function proposal() {
  return {
    schemaVersion: 1,
    repositoryId: "repo:forge",
    baseCommit: "a".repeat(40),
    goal: "Add a bounded validation helper",
    acceptanceCriteria: ["The helper rejects path traversal"],
    nonObjectives: ["Do not publish a release"],
    sourcePaths: ["src/forge/agent-fabric/journal.ts"],
    writablePaths: ["src/forge/agent-fabric/local-helper.ts"],
    requestedModelTargetId: "target:ollama:local",
    limits: {
      maximumAttempts: 1,
      maximumWallClockMs: 60_000,
      maximumOutputTokens: 2_048,
      maximumContextBytes: 16_384,
      maximumPatchBytes: 24_576,
      expiresAt: 2_000_000_000_000,
    },
  };
}

describe("local coding task proposal contract", () => {
  test("binds exact admitted content, then freezes a detached copy", () => {
    const request = proposal();
    const first = validateLocalCodingTaskProposal(request);
    const reordered = {
      limits: { ...request.limits },
      requestedModelTargetId: request.requestedModelTargetId,
      writablePaths: request.writablePaths,
      sourcePaths: request.sourcePaths,
      nonObjectives: request.nonObjectives,
      acceptanceCriteria: request.acceptanceCriteria,
      goal: request.goal,
      baseCommit: request.baseCommit,
      repositoryId: request.repositoryId,
      schemaVersion: request.schemaVersion,
    };
    expect(validateLocalCodingTaskProposal(reordered).proposalDigest).toBe(first.proposalDigest);
    request.goal = "Different goal";
    expect(first.proposal.goal).toBe("Add a bounded validation helper");
    expect(Object.isFrozen(first.proposal)).toBe(true);
    expect(Object.isFrozen(first.proposal.limits)).toBe(true);
    expect(validateLocalCodingTaskProposal(request).proposalDigest).not.toBe(first.proposalDigest);
  });

  test.each([
    ["absolute", "/etc/passwd"],
    ["parent", "src/../secrets.txt"],
    ["backslash", "src\\secrets.txt"],
    ["Git metadata", ".git/config"],
    ["Windows device", "CON.txt"],
    ["alternate stream", "src/file.txt:secret"],
    ["glob", "src/*.ts"],
    ["empty component", "src//file.ts"],
  ])("rejects %s path in source and write sets", (_name, path) => {
    for (const key of ["sourcePaths", "writablePaths"] as const) {
      const request = proposal();
      request[key] = [path];
      expect(() => validateLocalCodingTaskProposal(request)).toThrow(AgentFabricError);
    }
  });

  test("rejects case aliases and unexpected authority-shaped fields", () => {
    const duplicate = proposal();
    duplicate.writablePaths = ["src/Change.ts", "src/change.ts"];
    expect(() => validateLocalCodingTaskProposal(duplicate)).toThrow(AgentFabricError);
    expect(() => validateLocalCodingTaskProposal({
      ...proposal(), principalId: "owner:forged", effectClasses: ["consequential"],
    })).toThrow(AgentFabricError);
  });

  test("fails closed on malformed commit, budgets, expiry, and oversized text", () => {
    const invalidCommit = proposal();
    invalidCommit.baseCommit = "main";
    expect(() => validateLocalCodingTaskProposal(invalidCommit)).toThrow(AgentFabricError);
    const unbounded = proposal();
    unbounded.limits.maximumOutputTokens = 4_097;
    expect(() => validateLocalCodingTaskProposal(unbounded)).toThrow(AgentFabricError);
    const fractional = proposal();
    fractional.limits.maximumAttempts = 1.5;
    expect(() => validateLocalCodingTaskProposal(fractional)).toThrow(AgentFabricError);
    const oversized = proposal();
    oversized.goal = "a".repeat(4_001);
    expect(() => validateLocalCodingTaskProposal(oversized)).toThrow(AgentFabricError);
    const expiredShape = proposal();
    expiredShape.limits.expiresAt = Number.POSITIVE_INFINITY;
    expect(() => validateLocalCodingTaskProposal(expiredShape)).toThrow(AgentFabricError);
  });

  test("canonicalization rejects an accessor before it can run", () => {
    const request = proposal();
    let called = false;
    Object.defineProperty(request, "goal", {
      enumerable: true,
      get() {
        called = true;
        return "Forged";
      },
    });
    expect(() => validateLocalCodingTaskProposal(request)).toThrow(AgentFabricError);
    expect(called).toBe(false);
  });

  test("binds only bounded verification descriptors to the approved proposal", () => {
    const verification = { imageId: `sha256:${"a".repeat(64)}`, commands: [
      { kind: "git-diff-check", timeoutMs: 5_000 },
      { kind: "node-test-file", path: "pass.test.mjs", timeoutMs: 20_000 },
    ] };
    const accepted = validateLocalCodingTaskProposal({ ...proposal(), verification });
    expect(accepted.proposal.verification?.commands).toHaveLength(2);
    expect(validateLocalCodingTaskProposal(proposal()).proposalDigest).not.toBe(accepted.proposalDigest);
    expect(() => validateLocalCodingTaskProposal({ ...proposal(), verification: {
      ...verification, commands: [{ kind: "git-diff-check", timeoutMs: 5_000 },
        { kind: "node-test-file", path: "../secrets.test.mjs", timeoutMs: 20_000 }],
    } })).toThrow(AgentFabricError);
    expect(() => validateLocalCodingTaskProposal({ ...proposal(), verification: {
      ...verification, commands: [{ kind: "git-diff-check", timeoutMs: 5_000 },
        { kind: "shell", command: "curl example.com", timeoutMs: 20_000 }],
    } })).toThrow(AgentFabricError);
  });
});
