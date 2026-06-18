import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

describe("delta work session inference", () => {
  test("creates and updates an inferred work session from related operations", async () => {
    const root = tempWorkspace("delta-session-flow");
    try {
      const store = await DeltaStore.open(root);
      const actorId = await store.ensureActor("forge", "test");
      const recorderSession = await store.createSession({ source: "forge-command", git: { branch: "main", head: "a1" } });
      await store.appendOperation({
        sessionId: recorderSession,
        actorId,
        kind: "manifest.imported",
        summary: "import go-billing.manifest.json",
        data: { path: "go-billing.manifest.json" },
        artifacts: [{ path: "src/forge/_generated/externalServices.json", generated: true }],
      });
      await store.appendOperation({
        sessionId: recorderSession,
        actorId,
        kind: "runtime.entry.denied",
        summary: "billing.createInvoice denied",
        data: { entryName: "billing.createInvoice", diagnosticCode: "FORGE_POLICY_DENIED" },
        runtimeCall: {
          entryName: "billing.createInvoice",
          entryKind: "command",
          result: "denied",
          diagnosticCode: "FORGE_POLICY_DENIED",
          traceId: "trace_billing",
        },
      });
      await store.appendOperation({
        sessionId: recorderSession,
        actorId,
        kind: "file.changed",
        summary: "modified src/policies.ts",
        data: { path: "src/policies.ts" },
        fileChanges: [{ path: "src/policies.ts", changeType: "modified" }],
      });
      await store.appendOperation({
        sessionId: recorderSession,
        actorId,
        kind: "proof.run",
        summary: "security prove passed",
        data: { command: "forge security prove", exitCode: 0 },
        proof: { proofKind: "security-prove", command: "forge security prove", result: "passed" },
      });

      const status = await store.status();
      const sessions = await store.listWorkSessions();
      const current = await store.getWorkSessionDetails("current");
      const explain = await store.explain("billing.createInvoice");
      await store.close();

      expect(status.workSession?.title).toContain("billing");
      expect(sessions.length).toBe(1);
      expect(current?.operationCount).toBe(4);
      expect(current?.metadata.entries).toContain("billing.createInvoice");
      expect(current?.metadata.diagnostics).toContain("FORGE_POLICY_DENIED");
      expect(current?.metadata.proofs).toContain("security-prove");
      expect((explain.workSessions as unknown[]).length).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("branch changes split inferred work sessions", async () => {
    const root = tempWorkspace("delta-session-branch");
    try {
      const store = await DeltaStore.open(root);
      const actorId = await store.ensureActor("forge", "test");
      const main = await store.createSession({ source: "forge-command", git: { branch: "main", head: "a1" } });
      const feature = await store.createSession({ source: "forge-command", git: { branch: "feature/billing", head: "b1" } });
      await store.recordFilePath(main, "docs/why-forgeos.md", "modified");
      await store.appendOperation({
        sessionId: feature,
        actorId,
        kind: "runtime.entry.executed",
        summary: "billing.createInvoice success",
        data: { entryName: "billing.createInvoice" },
        runtimeCall: { entryName: "billing.createInvoice", entryKind: "command", result: "success" },
      });

      const sessions = await store.listWorkSessions();
      await store.close();

      expect(sessions.length).toBe(2);
      expect(sessions.some((session) => session.gitBranch === "main")).toBe(true);
      expect(sessions.some((session) => session.gitBranch === "feature/billing")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("supports timeline by session and manual corrections", async () => {
    const root = tempWorkspace("delta-session-corrections");
    try {
      const store = await DeltaStore.open(root);
      const recorderSession = await store.createSession({ source: "forge-command" });
      await store.recordFilePath(recorderSession, "src/policies.ts", "modified");
      const current = await store.getWorkSessionDetails("current");
      expect(current).toBeDefined();

      const renamed = await store.renameWorkSession("current", "Fix billing policy");
      const timeline = await store.timeline({ workSessionId: "current" });
      const split = await store.splitWorkSession("current", timeline[0]!.id);
      const detached = await store.detachWorkSessionOperation(timeline[0]!.id);
      await store.close();

      expect(renamed?.title).toBe("Fix billing policy");
      expect(timeline.length).toBe(1);
      expect(split?.metadata.splitFrom).toBe(current?.id);
      expect(detached).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses session-aware public delta commands", () => {
    const sessionList = parseCli(["session", "list", "--json"]).command;
    expect(sessionList?.kind).toBe("session");
    const sessionRename = parseCli(["session", "rename", "current", "Import", "billing"]).command;
    if (sessionRename?.kind === "session") {
      expect(sessionRename.title).toBe("Import billing");
    }
    const timeline = parseCli(["timeline", "--session", "current", "--kind", "proof.run"]).command;
    if (timeline?.kind === "timeline") {
      expect(timeline.sessionId).toBe("current");
      expect(timeline.kindFilter).toBe("proof.run");
      expect(timeline.target).toBeUndefined();
    }
    const explainSession = parseCli(["explain", "session", "current"]).command;
    if (explainSession?.kind === "explain") {
      expect(explainSession.thing).toBe("session:current");
    }
  });
});
