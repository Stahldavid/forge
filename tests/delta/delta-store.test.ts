import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore, DeltaStoreBusyError, describeDeltaStoreBusy, getDeltaStorePath } from "../../src/forge/delta/store.ts";
import { createPgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";
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
      expect(status.details).toBeUndefined();
      expect(status.recentOperations.length).toBeGreaterThan(0);
      expect(timeline.some((entry) => entry.kind === "runtime.entry.executed")).toBe(true);
      expect(explain.type).toBe("runtime-entry");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("delta status verbose includes aggregate store details without changing default output", async () => {
    const root = tempWorkspace("delta-status-verbose");
    try {
      const store = await DeltaStore.open(root);
      const actorId = await store.ensureActor("forge", "test");
      const sessionId = await store.createSession({ source: "forge-command" });
      await store.appendOperation({
        sessionId,
        actorId,
        kind: "command.executed",
        summary: "forge check success",
        data: { command: "forge check --json" },
      });
      await store.close();

      const compact = await runDeltaStatus(root);
      const verbose = await runDeltaStatus(root, { verbose: true });

      expect(compact.exitCode).toBe(0);
      if (compact.exitCode !== 0) {
        throw new Error("expected compact status success");
      }
      expect(compact.details).toBeUndefined();
      expect(verbose.exitCode).toBe(0);
      if (verbose.exitCode !== 0) {
        throw new Error("expected verbose status success");
      }
      expect(verbose.details?.schema.storedVersion).toBeDefined();
      expect(verbose.details?.paths.store).toBe(".forge/delta/delta.db");
      expect(verbose.details?.locks.forgeLockPresent).toBe(false);
      expect(verbose.details?.counts.operations).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(verbose)).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
      expect(repair.diagnostics[0]?.message).toContain("cwd=");
      expect(repair.diagnostics[0]?.message).toContain("command=");
      expect(repair.diagnostics[0]?.message).not.toContain(root);
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
  }, 30_000);

  test("busy lock diagnostics redact command secrets and relativize cwd", () => {
    const root = tempWorkspace("delta-busy-redaction");
    try {
      const busy = describeDeltaStoreBusy(
        new DeltaStoreBusyError(join(root, ".forge", "delta", "delta.lock"), {
          pid: process.pid,
          createdAt: new Date().toISOString(),
          cwd: join(root, "packages", "app"),
          command: "forge check --token sk_test_secret apiKey=abc123 Authorization=Bearer-secret Bearer raw-token",
        }),
        root,
      );
      expect(busy.cwd).toBe("packages/app");
      expect(busy.command).toContain("--token [REDACTED]");
      expect(busy.command).toContain("apiKey=[REDACTED]");
      expect(busy.command).toContain("Authorization=[REDACTED]");
      expect(busy.command).toContain("Bearer [REDACTED]");
      expect(busy.command).not.toContain("sk_test_secret");
      expect(busy.command).not.toContain("raw-token");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("status treats a held PGlite postmaster as an active local runtime", async () => {
    const root = tempWorkspace("delta-pglite-active-status");
    try {
      mkdirSync(join(root, ".forge", "delta", "delta.db", "postmaster.pid"), { recursive: true });

      const status = await runDeltaStatus(root);

      expect(status.exitCode).toBe(0);
      expect(status.ok).toBe(true);
      expect(status.recording).toBe(true);
      expect("external" in status ? status.external : undefined).toMatchObject({
        kind: "pglite-active",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("read opens migrate older DeltaDB schemas before querying agent memory", async () => {
    const root = tempWorkspace("delta-read-migrate");
    try {
      const store = await DeltaStore.open(root);
      await store.close();

      const adapter = await createPgliteAdapter(getDeltaStorePath(root));
      try {
        await adapter.query(`DROP TABLE agent_memory_events`);
        await adapter.query(`UPDATE delta_meta SET value = '0.0.0' WHERE key = 'schemaVersion'`);
      } finally {
        await adapter.close();
      }

      const reopened = await DeltaStore.open(root, { access: "read" });
      const events = await reopened.listAgentMemoryEvents({ target: "codex", limit: 5 });
      await reopened.close();

      expect(events).toEqual([]);
      const status = await runDeltaStatus(root);
      expect(status.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("fresh locks from exited processes are treated as stale", async () => {
    const root = tempWorkspace("delta-dead-lock");
    try {
      mkdirSync(join(root, ".forge", "delta"), { recursive: true });
      writeFileSync(
        join(root, ".forge", "delta", "delta.lock"),
        `${JSON.stringify({
          pid: 999999999,
          token: "dead",
          createdAt: new Date().toISOString(),
          cwd: root,
          command: "dead forge process",
        })}\n`,
      );

      const status = await runDeltaStatus(root);
      expect(status.exitCode).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
  }, 30_000);

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
  }, 30_000);

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
    const status = parseCli(["delta", "status", "--json", "--verbose"]).command;
    expect(status?.kind).toBe("delta");
    if (status?.kind === "delta") {
      expect(status.verbose).toBe(true);
    }
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
