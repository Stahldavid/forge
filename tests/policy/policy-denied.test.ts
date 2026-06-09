import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { FORGE_POLICY_DENIED } from "../../src/forge/compiler/diagnostics/codes.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runEntry } from "../../src/forge/runtime/executor.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "./helpers.ts";

describe("policy denied", () => {
  test("member cannot run billing.manage", async () => {
    const { root, tenantA } = await scaffoldPolicyWorkspace("policy-denied");
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
      expect(result.diagnostics.some((d) => d.code === FORGE_POLICY_DENIED)).toBe(true);
      expect(result.traceId).toBeDefined();
    } finally {
      cleanupWorkspace(root);
    }
  });
});
