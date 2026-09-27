import { expect, test } from "bun:test";
import { requestLocalApproval, requestLocalVerificationRecovery, type LocalApprovalView,
  type LocalVerificationRecoveryView } from "../../src/forge/agent-fabric/local-approval-window.ts";

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

test("recovery popup distinguishes clearing an untouched intent from continuing remaining tests", async () => {
  const common = {
    kind: "verification-recovery" as const,
    taskId: `task:${"a".repeat(64)}`,
    repositoryRoot: "C:/trusted/fixture",
    diffDigest: `sha256:${"b".repeat(64)}` as const,
    requestDigest: `sha256:${"c".repeat(64)}` as const,
  };
  const views: LocalVerificationRecoveryView[] = [
    { ...common, mode: "clear" },
    { ...common, mode: "continue", remainingCommands: [
      { path: "test/<unsafe>.test.mjs", timeoutMs: 20_000 },
    ] },
  ];
  for (const view of views) {
    const decision = await requestLocalVerificationRecovery(view, {
      timeoutMs: 5_000,
      openBrowser: async (url) => {
        const page = await fetch(url);
        const html = await page.text();
        expect(page.status).toBe(200);
        if (view.mode === "continue") {
          expect(html).toContain("Executar testes restantes");
          expect(html).toContain("test/&lt;unsafe&gt;.test.mjs");
          expect(html).toContain("Nenhum comando já iniciado será repetido");
          expect(html).not.toContain("nenhum contêiner foi iniciado");
        } else {
          expect(html).toContain("Permitir nova verificação");
          expect(html).toContain("nenhum contêiner foi iniciado");
        }
        const endpoint = new URL(url);
        endpoint.pathname = `/decision/${endpoint.pathname.slice(1)}`;
        const accepted = await fetch(endpoint, { method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded",
            Origin: "null", "Sec-Fetch-Site": "same-origin" },
          body: new URLSearchParams({ digest: view.requestDigest, decision: "approved" }) });
        expect(accepted.status).toBe(200);
      },
    });
    expect(decision).toBe("approved");
  }
});
