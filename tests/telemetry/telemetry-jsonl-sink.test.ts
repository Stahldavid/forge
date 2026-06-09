import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeLocalJsonl, localJsonlPaths } from "../../src/forge/runtime/telemetry/sinks/local-jsonl.ts";
import type { ForgeTelemetryEnvelope } from "../../src/forge/runtime/telemetry/types.ts";

describe("telemetry local jsonl sink", () => {
  test("writes events to jsonl files", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-telemetry-"));
    try {
      const envelope: ForgeTelemetryEnvelope = {
        schemaVersion: "0.1",
        type: "event",
        traceId: "trace-1",
        environment: "test",
        runtime: { kind: "command", name: "createTicket" },
        event: { name: "ticket_created", properties: { id: "1" } },
        createdAt: new Date().toISOString(),
      };

      await writeLocalJsonl(envelope, workspace);
      const paths = localJsonlPaths(workspace);
      expect(existsSync(paths.events)).toBe(true);
      const content = readFileSync(paths.events, "utf8");
      expect(content).toContain("ticket_created");
      expect(content).toContain("trace-1");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
