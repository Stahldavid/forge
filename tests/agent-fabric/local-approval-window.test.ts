import { expect, test } from "bun:test";
import { requestLocalApproval, type LocalApprovalView } from "../../src/forge/agent-fabric/local-approval-window.ts";

test("local popup accepts Chrome no-referrer same-origin POST but rejects cross-site POST", async () => {
  const view: LocalApprovalView = {
    taskId: `task:${"a".repeat(64)}`,
    repositoryRoot: "C:/trusted/fixture",
    proposalDigest: `sha256:${"a".repeat(64)}`,
    proposal: {
      schemaVersion: 1, repositoryId: "repo:fixture", baseCommit: "a".repeat(40),
      goal: "Change a fixture", acceptanceCriteria: ["fixture changes"], nonObjectives: [],
      sourcePaths: ["fixture.txt"], writablePaths: ["fixture.txt"],
      requestedModelTargetId: "target:ollama:local",
      limits: { maximumAttempts: 1, maximumWallClockMs: 60_000, maximumOutputTokens: 256,
        maximumContextBytes: 4_096, maximumPatchBytes: 4_096, expiresAt: Date.now() + 60_000 },
    },
  };
  const decision = await requestLocalApproval(view, {
    timeoutMs: 5_000,
    openBrowser: async (url) => {
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(page.headers.get("referrer-policy")).toBe("no-referrer");
      const endpoint = new URL(url);
      endpoint.pathname = `/decision/${endpoint.pathname.slice(1)}`;
      const body = new URLSearchParams({ digest: view.proposalDigest, decision: "approved" });
      const headers = { "Content-Type": "application/x-www-form-urlencoded",
        Origin: "null", "Sec-Fetch-Site": "cross-site" };
      const rejected = await fetch(endpoint, { method: "POST", headers, body });
      expect(rejected.status).toBe(403);
      const accepted = await fetch(endpoint, { method: "POST",
        headers: { ...headers, "Sec-Fetch-Site": "same-origin" }, body });
      expect(accepted.status).toBe(200);
    },
  });
  expect(decision).toBe("approved");
});
