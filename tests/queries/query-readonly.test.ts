import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { resetCompileSessions } from "../../src/forge/compiler/orchestrator/session.ts";
import {
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { createReadOnlyDbClient } from "../../src/forge/runtime/db/read-only-client.ts";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { createQueryContext } from "../../src/forge/runtime/context/create-query-context.ts";
import { createNoopTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { generateTraceId } from "../../src/forge/runtime/telemetry/correlation.ts";
import { cleanupWorkspace, defaultGenerateOptions, scaffoldQueryWorkspace } from "./helpers.ts";

describe("query read-only enforcement", () => {
  test("forge check flags write/emit in query handlers", async () => {
    const { root } = await scaffoldQueryWorkspace("query-readonly-check");
    const queriesDir = join(root, "src", "queries");

    writeFileSync(
      join(queriesDir, "badWrite.ts"),
      `
        import { query } from "forge/server";
        export const badWrite = query({
          handler: async (ctx) => {
            await ctx.db.tickets.insert({ title: "nope" });
            return [];
          },
        });
      `,
      "utf8",
    );

    writeFileSync(
      join(queriesDir, "badEmit.ts"),
      `
        import { query } from "forge/server";
        export const badEmit = query({
          handler: async (ctx) => {
            await ctx.emit("x", {});
            return [];
          },
        });
      `,
      "utf8",
    );

    try {
      resetCompileSessions();
      await run(defaultGenerateOptions(root));
      const checked = await import("../../src/forge/cli/commands.ts").then((m) =>
        m.runCheckCommand(root),
      );
      expect(checked.errors.some((e) => e.code === FORGE_QUERY_WRITE_FORBIDDEN)).toBe(true);
      expect(checked.errors.some((e) => e.code === FORGE_QUERY_EMIT_FORBIDDEN)).toBe(true);
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("read-only db client blocks writes at runtime", async () => {
    const adapter = createMemoryAdapter();
    const tx = adapterAsTransaction(adapter);
    const db = createReadOnlyDbClient(tx, {
      tickets: {
        tableName: "tickets",
        columns: [
          { name: "id", sqlType: "uuid", primaryKey: true },
          { name: "title", sqlType: "text" },
        ],
        tenantScoped: false,
      },
    });
    const ctx = createQueryContext(db, createNoopTelemetryContext(generateTraceId()), {
      kind: "user",
      userId: "u1",
      tenantId: "t1",
      role: "member",
    });

    expect("insert" in ctx.db.tickets).toBe(false);
    expect("update" in ctx.db.tickets).toBe(false);
    expect("delete" in ctx.db.tickets).toBe(false);
    expect(() => ctx.emit).toThrow(FORGE_QUERY_EMIT_FORBIDDEN);
    expect(() => ctx.secrets).toThrow();
    expect(() => ctx.ai).toThrow();
  });
});
