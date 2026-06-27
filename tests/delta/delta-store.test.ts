import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore, DeltaStoreBusyError, describeDeltaStoreBusy, getDeltaStorePath } from "../../src/forge/delta/store.ts";
import { createPgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";
import { runDeltaExplain } from "../../src/forge/delta/explain.ts";
import { runDeltaSessionCommand } from "../../src/forge/delta/session.ts";
import { runDeltaCompact, runDeltaDoctor, runDeltaExport, runDeltaPrune, runDeltaRepair, runDeltaStatus } from "../../src/forge/delta/status.ts";
import { runDeltaTimeline } from "../../src/forge/delta/timeline.ts";
import { redactDeltaPayload } from "../../src/forge/delta/redaction.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { recordParsedCliCommand } from "../../src/forge/delta/recorder.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

function markFrameworkCheckout(root: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "forge.mjs"), "#!/usr/bin/env node\n", "utf8");
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

  test("delta command hints use the repo-local Forge CLI in framework checkouts", async () => {
    const root = tempWorkspace("delta-local-cli-hints");
    try {
      markFrameworkCheckout(root);
      mkdirSync(join(root, ".forge", "delta", "delta.db"), { recursive: true });

      const repair = await runDeltaRepair({ workspaceRoot: root, dryRun: true, yes: false });
      expect(repair.nextActions).toContain("node bin/forge.mjs delta repair --yes --json");
      expect(repair.nextActions).not.toContain("forge delta repair --yes --json");

      const rejectedExport = await runDeltaExport({ workspaceRoot: root, redacted: false });
      expect(rejectedExport.nextActions).toContain("node bin/forge.mjs delta export --redacted --json");
      expect(rejectedExport.diagnostics[0]?.suggestedCommands).toContain("node bin/forge.mjs delta export --redacted --json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("delta compact and prune maintain redacted local queue history", async () => {
    const root = tempWorkspace("delta-maintenance");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const historyPath = join(agentDir, "events.ndjson.history");
      writeFileSync(
        historyPath,
        [
          JSON.stringify({ enqueuedAt: "2020-01-01T00:00:00.000Z", payload: { token: "sk_delta_secret_123456" } }),
          JSON.stringify({ enqueuedAt: new Date().toISOString(), payload: { summary: "safe" } }),
        ].join("\n") + "\n",
        "utf8",
      );

      const compact = await runDeltaCompact({ workspaceRoot: root });
      expect(compact.exitCode).toBe(0);
      expect(compact.files[0]?.linesAfter).toBe(2);
      const compacted = readFileSync(historyPath, "utf8");
      expect(compacted).not.toContain("sk_delta_secret_123456");
      expect(compacted).toContain("[REDACTED]");

      const dryRun = await runDeltaPrune({ workspaceRoot: root, olderThan: "30d", dryRun: true });
      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.applied).toBe(false);
      expect(dryRun.files[0]?.prunedLines).toBe(1);

      const planned = await runDeltaPrune({ workspaceRoot: root, olderThan: "30d" });
      expect(planned.needsConfirmation).toBe(true);
      expect(readFileSync(historyPath, "utf8").split(/\n/u).filter(Boolean)).toHaveLength(2);

      const pruned = await runDeltaPrune({ workspaceRoot: root, olderThan: "30d", yes: true });
      expect(pruned.applied).toBe(true);
      expect(readFileSync(historyPath, "utf8").split(/\n/u).filter(Boolean)).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("delta export requires redacted mode and writes redacted local evidence", async () => {
    const root = tempWorkspace("delta-export");
    try {
      const store = await DeltaStore.open(root);
      const actorId = await store.ensureActor("forge", "test");
      const sessionId = await store.createSession({ source: "forge-command" });
      await store.appendOperation({
        sessionId,
        actorId,
        kind: "command.executed",
        summary: "forge check success",
        data: { command: "forge check --json", token: "sk_delta_export_secret" },
      });
      await store.close();

      const rejected = await runDeltaExport({ workspaceRoot: root, redacted: false });
      expect(rejected.exitCode).toBe(1);
      expect(rejected.diagnostics[0]?.code).toBe("FORGE_DELTA_EXPORT_REDACTED_REQUIRED");

      const exported = await runDeltaExport({
        workspaceRoot: root,
        redacted: true,
        output: ".forge/delta/export.json",
        limit: 10,
      });
      expect(exported.exitCode).toBe(0);
      expect(exported.written).toBe(true);
      expect(exported.output).toBe(".forge/delta/export.json");
      const file = readFileSync(join(root, ".forge", "delta", "export.json"), "utf8");
      expect(file).not.toContain("sk_delta_export_secret");
      expect(file).toContain("[REDACTED]");
      expect(exported.data?.semanticTimeline).toMatchObject({
        events: [],
        projection: { lastRebuildAt: undefined },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
      const details = verbose.details;
      expect(details).toBeDefined();
      if (!details) {
        throw new Error("expected verbose details");
      }
      expect(details.schema.storedVersion).toBeDefined();
      expect(details.paths.store).toBe(".forge/delta/delta.db");
      expect(details.locks.forgeLockPresent).toBe(false);
      expect(details.counts.operations).toBeGreaterThanOrEqual(1);
      expect(["ok", "warning"]).toContain(details.health.status);
      expect(details.health.checks.some((check) => check.name === "queue-redaction")).toBe(true);
      expect(details.operational.queuePath).toBe(".forge/agent/events.ndjson");
      expect(details.operational.queuePendingEvents).toBe(0);
      expect(details.operational.queueHistoryPath).toBe(".forge/agent/events.ndjson.history");
      expect(details.operational.queueHistoryLines).toBe(0);
      expect(details.operational.queueRedaction).toBe("none");
      expect(details.operational.estimatedOverhead).toBe("low");
      expect(details.operational.oldestOperationAt).toBeDefined();
      expect(JSON.stringify(verbose)).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("delta doctor checks recorder health, queue posture, and gitignore coverage", async () => {
    const root = tempWorkspace("delta-doctor");
    try {
      writeFileSync(join(root, ".gitignore"), ".forge/delta/\n.forge/agent/*.ndjson\n.forge/studio/\n");
      const store = await DeltaStore.open(root);
      await store.close();

      const result = await runDeltaDoctor(root);

      expect(result.exitCode).toBe(0);
      expect(result.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
        "delta-status",
        "delta-writable",
        "schema-current",
        "queue-drain",
        "queue-redaction",
        "gitignore-operational-state",
      ]));
      expect(result.checks.find((check) => check.name === "gitignore-operational-state")?.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("delta doctor treats an active PGlite runtime as a writable warning", async () => {
    const root = tempWorkspace("delta-doctor-pglite-active");
    try {
      writeFileSync(join(root, ".gitignore"), ".forge/delta/\n.forge/agent/*.ndjson\n.forge/studio/\n");
      mkdirSync(join(root, ".forge", "delta", "delta.db", "postmaster.pid"), { recursive: true });

      const result = await runDeltaDoctor(root);

      expect(result.exitCode).toBe(0);
      expect(result.ok).toBe(true);
      const writable = result.checks.find((check) => check.name === "delta-writable");
      expect(writable).toMatchObject({
        ok: false,
        severity: "warning",
      });
      expect(writable?.message).toContain("PGlite runtime");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("records CAIR activity as semantic timeline events", async () => {
    const root = tempWorkspace("delta-cair-recording");
    try {
      const argv = ["cair", "query", "Q", "ST"];
      const parsed = parseCli(argv);
      expect(parsed.errors).toEqual([]);
      if (!parsed.command) {
        throw new Error("expected parsed CAIR command");
      }

      if (parsed.command.kind !== "cair") {
        throw new Error("expected parsed CAIR command kind");
      }
      const command = {
        ...parsed.command,
        options: {
          ...parsed.command.options,
          workspaceRoot: root,
        },
      };

      await recordParsedCliCommand({
        command,
        argv,
        exitCode: 0,
        durationMs: 12,
      });

      const store = await DeltaStore.open(root, { access: "read" });
      const timeline = await store.semanticTimeline({ target: "cair:protocol" });
      await store.close();

      expect(timeline.events.some((event) => event.kind === "cair.query.run")).toBe(true);
      expect(timeline.events.some((event) => event.entities.some((entity) => entity.kind === "cair"))).toBe(true);
      expect(JSON.stringify(timeline)).toContain("\"queryVerb\":\"Q ST\"");
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

  test("explain falls back to the current agent contract when Delta has no runtime history", async () => {
    const root = tempWorkspace("delta-explain-contract-fallback");
    try {
      mkdirSync(join(root, "src", "forge", "_generated"), { recursive: true });
      writeFileSync(join(root, "src", "forge", "_generated", "agentContract.json"), JSON.stringify({
        commands: [
          {
            name: "billing.createInvoice",
            auth: "can('billing.manage')",
            policy: "billing.manage",
            tenantScoped: true,
            file: "src/commands/billing.createInvoice.ts",
          },
        ],
        queries: [],
        liveQueries: [],
        actions: [],
        workflows: [],
      }));

      const explain = await runDeltaExplain({ workspaceRoot: root, thing: "billing.createInvoice" });

      expect(explain.exitCode).toBe(0);
      expect(explain.explanation.type).toBe("runtime-entry");
      expect(explain.explanation.runtime).toMatchObject({
        entry_name: "billing.createInvoice",
        entry_kind: "command",
        result: "defined",
        source: "agentContract",
      });
      expect(explain.explanation.currentContract).toMatchObject({
        source: "src/forge/_generated/agentContract.json",
        kind: "command",
        name: "billing.createInvoice",
        policy: "billing.manage",
        tenantScoped: true,
      });
      expect(JSON.stringify(explain.explanation.semanticTimeline)).toContain("No semantic history found");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

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
