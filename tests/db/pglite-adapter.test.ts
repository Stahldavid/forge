import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rmSync, mkdirSync } from "node:fs";
import { createPgliteAdapter } from "../../src/forge/runtime/db/pglite-adapter.ts";

describe("pglite adapter", () => {
  test("connects and runs queries", async () => {
    const dataDir = join(import.meta.dir, ".tmp", `pglite-${Bun.randomUUIDv7()}`);
    mkdirSync(join(import.meta.dir, ".tmp"), { recursive: true });
    const adapter = await createPgliteAdapter(dataDir);

    try {
      const result = await adapter.query("SELECT 1 AS value");
      expect(result.rows[0]?.value).toBe(1);
    } finally {
      await adapter.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("supports transactions", async () => {
    const dataDir = join(import.meta.dir, ".tmp", `pglite-tx-${Bun.randomUUIDv7()}`);
    mkdirSync(join(import.meta.dir, ".tmp"), { recursive: true });
    const adapter = await createPgliteAdapter(dataDir);

    try {
      await adapter.query(
        `CREATE TABLE IF NOT EXISTS "items" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "name" text NOT NULL)`,
      );

      const tx = await adapter.begin();
      await tx.query(`INSERT INTO "items" ("name") VALUES ($1)`, ["alpha"]);
      await tx.commit();

      const rows = await adapter.query(`SELECT "name" FROM "items"`);
      expect(rows.rows).toHaveLength(1);
    } finally {
      await adapter.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
