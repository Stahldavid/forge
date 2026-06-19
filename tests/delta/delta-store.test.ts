import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { redactDeltaPayload } from "../../src/forge/delta/redaction.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { recordParsedCliCommand } from "../../src/forge/delta/recorder.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

describe("delta store", () => {
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
