import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { runDeltaExplain } from "../../src/forge/delta/explain.ts";
import { runDeltaSessionCommand } from "../../src/forge/delta/session.ts";
import { runDeltaRepair, runDeltaStatus } from "../../src/forge/delta/status.ts";
import { runDeltaTimeline } from "../../src/forge/delta/timeline.ts";
import { redactDeltaPayload } from "../../src/forge/delta/redaction.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { recordParsedCliCommand } from "../../src/forge/delta/recorder.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

describe("delta store", () => {
  test("delta repair dry-run plans a backup without mutating the store", async () => {
    const root = tempWorkspace("delta-repair-preview");
    try {
      mkdirSync(join(root, ".forge", "delta", "delta.db"), { recursive: true });
      writeFileSync(join(root, ".forge", "delta", "delta.db", "postmaster.pid"), "-42\n");

      const result = await runDeltaRepair({ workspaceRoot: root, dryRun: true, yes: false });

      expect(result.ok).toBe(true);
      expect(result.applied).toBe(false);
      expect(result.needsConfirmation).toBe(true);
      expect(result.store).toBe(".forge/delta/delta.db");
      expect(result.backupPath).toContain(".forge/delta/backups/delta.db.");
      expect(result.actions.some((action) => action.kind === "backup")).toBe(true);
      expect(result.nextActions).toContain("forge delta repair --yes --json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("initializes, records operations, and returns status", async () => {
    const root = tempWorkspace("delta-store");
    try {
      const store = await DeltaStore.open(root);
      const actorId = await store.ensureActor("forge", "test");
      const sessionId = await store.createSession({ source: "forge-command" });
      await store.appendOperation({
        sessionId,
        actorId,
        kind: "runtime.entry.executed",
        summary: "billing.createInvoice success",
        data: { entryName: "billing.createInvoice" },
        runtimeCall: {
          entryName: "billing.createInvoice",
          entryKind: "command",
          result: "success",
          traceId: "trace_test",
        },
      });

      const status = await store.status();
      const timeline = await store.timeline({ target: "billing.createInvoice" });
      const explain = await store.explain("billing.createInvoice");
      await store.close();

      expect(status.recording).toBe(true);
      expect(status.recentOperations.length).toBeGreaterThan(0);
      expect(timeline.some((entry) => entry.kind === "runtime.entry.executed")).toBe(true);
      expect(explain.type).toBe("runtime-entry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("allows status reads while blocking mutable repair when the local store is open", async () => {
    const root = tempWorkspace("delta-busy");
    let store: DeltaStore | null = null;
    try {
      store = await DeltaStore.open(root);
      const dryRun = await runDeltaRepair({ workspaceRoot: root, dryRun: true, yes: false });
      expect(dryRun.exitCode).toBe(0);

      const status = await runDeltaStatus(root);
      expect(status.exitCode).toBe(0);
      if (status.exitCode !== 0) {
        throw new Error("expected Delta status to read while a writer is open");
      }
      expect(status.recording).toBe(true);

      const timeline = await runDeltaTimeline({ workspaceRoot: root, limit: 10 });
      expect(timeline.exitCode).toBe(0);
      expect(timeline.ok).toBe(true);

      const explain = await runDeltaExplain({ workspaceRoot: root, thing: "billing.createInvoice" });
      expect(explain.exitCode).toBe(0);
      expect(explain.ok).toBe(true);

      const sessions = await runDeltaSessionCommand({ workspaceRoot: root, subcommand: "list", limit: 10 });
      expect(sessions.exitCode).toBe(0);
      expect(sessions.ok).toBe(true);

      const repair = await runDeltaRepair({ workspaceRoot: root, dryRun: false, yes: true });
      expect(repair.exitCode).toBe(1);
      expect(repair.diagnostics[0]?.code).toBe("FORGE_DELTA_BUSY");
      expect(repair.busy).toMatchObject({
        code: "FORGE_DELTA_BUSY",
        relativeLockPath: ".forge/delta/delta.lock",
        processAlive: true,
        holderKnown: true,
      });
      expect(repair.busy?.pid).toBe(process.pid);
      expect(repair.nextActions).toContain("forge agent timeline --json");
      expect(repair.applied).toBe(false);

      await store.close();
      store = null;
      const reopened = await runDeltaStatus(root);
      expect(reopened.exitCode).toBe(0);
    } finally {
      if (store) {
        await store.close();
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("records file changes with semantic hints", async () => {
    const root = tempWorkspace("delta-file");
    try {
      writeFileSync(join(root, "src-policies.ts"), "export {}\n");
      const store = await DeltaStore.open(root);
      const sessionId = await store.createSession({ source: "forge-dev" });
      await store.recordFilePath(sessionId, "src/policies.ts", "modified");
      const timeline = await store.timeline({ target: "src/policies.ts" });
      await store.close();
      expect(timeline[0]?.kind).toBe("file.changed");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("enriches external runtime calls from generated service metadata", async () => {
    const root = tempWorkspace("delta-external-runtime");
    try {
      const generated = join(root, "src/forge/_generated");
      mkdirSync(generated, { recursive: true });
      writeFileSync(
        join(generated, "externalServices.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          services: [
            {
              name: "billing",
              language: "java",
              entries: [
                {
                  name: "createInvoice",
                  kind: "command",
                  risk: "write",
                  policy: "billing.manage",
                  tenantScoped: true,
                  needsApproval: true,
                },
              ],
            },
          ],
        }),
      );

      await recordParsedCliCommand({
        command: {
          kind: "run",
          name: "billing.createInvoice",
          list: false,
          json: true,
          mock: false,
          workspaceRoot: root,
        },
        argv: ["forge", "run", "billing.createInvoice", "--json"],
        exitCode: 0,
        durationMs: 12,
      });

      const store = await DeltaStore.open(root);
      const timeline = await store.semanticTimeline({ target: "billing.createInvoice" });
      await store.close();

      expect(timeline.currentState).toMatchObject({
        kind: "command",
        service: "billing",
        language: "java",
        risk: "write",
        policy: "billing.manage",
        tenantScoped: true,
        needsApproval: true,
        lastResult: "success",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("redacts secret-like keys and known values", () => {
    const redacted = redactDeltaPayload(
      {
        args: {
          apiKey: "sk_h44_canary_secret_123456",
          nested: "prefix sk_h44_canary_secret_123456 suffix",
        },
      },
      { secretValues: ["sk_h44_canary_secret_123456"] },
    );
    const serialized = JSON.stringify(redacted.value);
    expect(serialized).not.toContain("sk_h44_canary_secret_123456");
    expect(serialized).toContain("[REDACTED]");
  });

  test("parses public delta commands", () => {
    expect(parseCli(["delta", "status", "--json"]).command?.kind).toBe("delta");
    const timeline = parseCli(["timeline", "billing.createInvoice", "--kind", "runtime.entry.executed"]).command;
    expect(timeline?.kind).toBe("timeline");
    if (timeline?.kind === "timeline") {
      expect(timeline.target).toBe("billing.createInvoice");
      expect(timeline.kindFilter).toBe("runtime.entry.executed");
    }
    const kindOnly = parseCli(["timeline", "--kind", "proof.run"]).command;
    if (kindOnly?.kind === "timeline") {
      expect(kindOnly.target).toBeUndefined();
      expect(kindOnly.kindFilter).toBe("proof.run");
    }
    expect(parseCli(["explain", "billing.createInvoice"]).command?.kind).toBe("explain");
  });
});
