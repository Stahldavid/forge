import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("telemetry policy denied", () => {
  test("captures forge.policy.denied with traceId", async () => {
    const { root, tenantA } = await scaffoldPolicyWorkspace("telemetry-policy-denied");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      const result = await runEntry(root, "manageBilling", {
        json: false,
        mock: false,
        db: adapter,
        userId: "user-1",
        tenantId: tenantA,
        role: "member",
      });

      expect(result.ok).toBe(false);
      expect(result.traceId).toBeDefined();

      const events = await adapter.query(
        `SELECT event_type, payload, trace_id FROM _forge_telemetry_events WHERE trace_id = $1`,
        [result.traceId],
      );

      const denied = events.rows.find(
        (row) => String(row.event_type) === "forge.policy.denied",
      );
      expect(denied).toBeDefined();

      const payload =
        typeof denied?.payload === "string"
          ? JSON.parse(String(denied.payload))
          : denied?.payload;
      const properties = payload.event.properties;
      expect(properties.command).toBe("manageBilling");
      expect(properties.policy).toBe("billing.manage");
      expect(properties.role).toBe("member");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
