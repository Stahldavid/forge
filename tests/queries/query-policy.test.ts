import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { FORGE_POLICY_DENIED } from "../../src/forge/compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { runQuery } from "../../src/forge/runtime/query/run-query.ts";
import { cleanupWorkspace, scaffoldQueryWorkspace } from "./helpers.ts";

describe("query policy", () => {
  test("denies anonymous callers for protected queries", async () => {
    const { root } = await scaffoldQueryWorkspace("query-policy");
    try {
      const adapter = createMemoryAdapter();
      const sqlPlan = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "sqlPlan.json"), "utf8"),
        ),
      ) as SqlPlan;
      await applyMigrations(adapter, sqlPlan);

      const result = await runQuery(
        root,
        "listTickets",
        { auth: { kind: "anonymous" } },
        {
          adapter,
          tableMap: JSON.parse(
            stripDeterministicHeader(readFileSync(join(root, GENERATED_DIR, "db.json"), "utf8")),
          ).tableMap,
        },
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.some((d) => d.code === FORGE_POLICY_DENIED)).toBe(true);
    } finally {
      cleanupWorkspace(root);
    }
  });
});
