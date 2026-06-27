import { describe, expect, test } from "bun:test";
import { adapterAsTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { createGeneratedDbClient } from "../../src/forge/runtime/db/generated-client.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";

describe("generated db client field aliases", () => {
  test("exposes snake_case table names through camelCase runtime aliases", async () => {
    const adapter = createMemoryAdapter();
    await adapter.query(
      `CREATE TABLE IF NOT EXISTS incident_messages (id text PRIMARY KEY, incident_id text NOT NULL, content text NOT NULL)`,
    );

    const db = createGeneratedDbClient(adapterAsTransaction(adapter), {
      incident_messages: {
        tableName: "incident_messages",
        columns: [
          { name: "id", fieldName: "id", sqlType: "text", primaryKey: true },
          { name: "incident_id", fieldName: "incidentId", sqlType: "text" },
          { name: "content", fieldName: "content", sqlType: "text" },
        ],
      },
    });

    await db.incidentMessages.insert({
      id: "msg-1",
      incidentId: "incident-1",
      content: "The room opened.",
    });

    expect(await db.incident_messages.where({ incidentId: "incident-1" })).toHaveLength(1);
    expect(await db.incidentMessages.where({ incident_id: "incident-1" })).toHaveLength(1);

    await adapter.close();
  });

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

  test("updates tenant-scoped rows in the memory adapter with id before tenant filter", async () => {
    const adapter = createMemoryAdapter();
    await adapter.query(
      `CREATE TABLE IF NOT EXISTS approvals (id text PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL)`,
    );

    const db = createGeneratedDbClient(
      adapterAsTransaction(adapter),
      {
        approvals: {
          tableName: "approvals",
          tenantScoped: true,
          tenantIdColumn: "tenant_id",
          columns: [
            { name: "id", fieldName: "id", sqlType: "text", primaryKey: true },
            { name: "tenant_id", fieldName: "tenantId", sqlType: "text" },
            { name: "status", fieldName: "status", sqlType: "text" },
          ],
        },
      },
      {
        auth: {
          kind: "user",
          userId: "u1",
          tenantId: "tenant-a",
          role: "owner",
        },
      },
    );

    await db.approvals.insert({ id: "approval-1", tenantId: "tenant-a", status: "draft" });

    const updated = await db.approvals.update("approval-1", { status: "approved" });
    expect(updated?.status).toBe("approved");

    const rows = await db.approvals.all();
    expect(rows).toEqual([
      expect.objectContaining({ id: "approval-1", tenantId: "tenant-a", status: "approved" }),
    ]);

    await adapter.close();
  });

  test("memory adapter rejects empty timestamps and returns Date values like pglite", async () => {
    const adapter = createMemoryAdapter();
    await adapter.query(
      `CREATE TABLE IF NOT EXISTS events (id text PRIMARY KEY, tenant_id text NOT NULL, starts_at timestamptz NOT NULL)`,
    );

    const inserted = await adapter.query(
      `INSERT INTO events (id, tenant_id, starts_at) VALUES ($1, $2, $3) RETURNING *`,
      ["event-1", "tenant-a", "2026-06-12T00:00:00.000Z"],
    );

    expect(inserted.rows[0]?.starts_at).toBeInstanceOf(Date);
    expect((inserted.rows[0]?.starts_at as Date).toISOString()).toBe("2026-06-12T00:00:00.000Z");

    await expect(
      adapter.query(
        `INSERT INTO events (id, tenant_id, starts_at) VALUES ($1, $2, $3) RETURNING *`,
        ["event-2", "tenant-a", ""],
      ),
    ).rejects.toThrow("FORGE_DB_INVALID_TIMESTAMP");

    await expect(
      adapter.query(
        `UPDATE events SET starts_at = $1 WHERE id = $2`,
        ["", "event-1"],
      ),
    ).rejects.toThrow("FORGE_DB_INVALID_TIMESTAMP");

    await adapter.close();
  });
});
