import { describe, expect, test } from "bun:test";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { createGeneratedDbClient } from "../../src/forge/runtime/db/generated-client.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";

describe("generated db client field aliases", () => {
  test("accepts TypeScript field names and maps them to SQL columns", async () => {
    const adapter = createMemoryAdapter();
    await adapter.query(
      `CREATE TABLE IF NOT EXISTS tickets (id text PRIMARY KEY, tenant_id text NOT NULL, triage_summary text NOT NULL, updated_at text NOT NULL)`,
    );

    const db = createGeneratedDbClient(
      adapterAsTransaction(adapter),
      {
        tickets: {
          tableName: "tickets",
          columns: [
            { name: "id", fieldName: "id", sqlType: "text", primaryKey: true },
            { name: "tenant_id", fieldName: "tenantId", sqlType: "text" },
            { name: "triage_summary", fieldName: "triageSummary", sqlType: "text" },
            { name: "updated_at", fieldName: "updatedAt", sqlType: "text" },
          ],
        },
      },
      {
        auth: {
          kind: "user",
          userId: "u1",
          tenantId: "tenant-a",
          role: "member",
        },
      },
    );

    const inserted = await db.tickets.insert({
      id: "ticket-a",
      tenantId: "tenant-a",
      triageSummary: "Waiting for workflow triage.",
      updatedAt: "2026-06-12T00:00:00.000Z",
    });

    expect(inserted.triage_summary).toBe("Waiting for workflow triage.");
    expect(inserted.triageSummary).toBe("Waiting for workflow triage.");
    expect(inserted.tenant_id).toBe("tenant-a");
    expect(inserted.tenantId).toBe("tenant-a");

    const rows = await db.tickets.where({ triageSummary: "Waiting for workflow triage." });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.triageSummary).toBe("Waiting for workflow triage.");

    const updated = await db.tickets.update("ticket-a", {
      triageSummary: "Mock AI triage complete.",
    });
    expect(updated?.triage_summary).toBe("Mock AI triage complete.");
    expect(updated?.triageSummary).toBe("Mock AI triage complete.");

    await adapter.close();
  });
});
