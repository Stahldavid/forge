import type { DbAdapter, DbTransaction } from "../db/adapter.ts";
import { currentReleaseInfo } from "../release/runtime.ts";
import type { DataChange, LiveInvalidation } from "./types.ts";

export const LIVE_INVALIDATION_SEQUENCE_SQL =
  "CREATE SEQUENCE IF NOT EXISTS _forge_live_revision_seq START WITH 2";

export const LIVE_INVALIDATION_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS _forge_live_invalidations (id bigserial PRIMARY KEY, revision bigint NOT NULL, table_name text NOT NULL, tenant_id text, operation text NOT NULL, source_kind text NOT NULL, source_name text, trace_id text, release_id text, deploy_id text, payload jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())";

export const LIVE_SUBSCRIPTION_DEBUG_TABLE_SQL =
  "CREATE TABLE IF NOT EXISTS _forge_live_subscription_debug (id text PRIMARY KEY, name text NOT NULL, tenant_id text, dependencies jsonb NOT NULL, last_revision bigint, runtime_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())";

const LIVE_INVALIDATION_INDEX_SQL = [
  "CREATE INDEX IF NOT EXISTS forge_live_invalidations_revision_idx ON _forge_live_invalidations (revision)",
  "CREATE INDEX IF NOT EXISTS forge_live_invalidations_table_tenant_revision_idx ON _forge_live_invalidations (table_name, tenant_id, revision)",
];

export interface WriteLiveInvalidationsInput {
  changes: DataChange[];
  sourceKind: string;
  sourceName?: string;
  traceId?: string;
  payload?: Record<string, unknown>;
}

export async function ensureLiveInvalidationSchema(
  db: DbAdapter | DbTransaction,
): Promise<void> {
  await db.query(LIVE_INVALIDATION_SEQUENCE_SQL);
  await db.query(LIVE_INVALIDATION_TABLE_SQL);
  await db.query(LIVE_SUBSCRIPTION_DEBUG_TABLE_SQL);
  for (const sql of LIVE_INVALIDATION_INDEX_SQL) {
    await db.query(sql);
  }
}

async function nextRevision(tx: DbTransaction): Promise<number> {
  const result = await tx.query(
    "SELECT nextval('_forge_live_revision_seq') AS revision",
  );
  const revision = Number(result.rows[0]?.revision ?? result.rows[0]?.nextval);
  if (!Number.isFinite(revision)) {
    throw new Error("live invalidation revision allocation failed");
  }
  return revision;
}

export async function writeLiveInvalidations(
  tx: DbTransaction,
  input: WriteLiveInvalidationsInput,
): Promise<LiveInvalidation[]> {
  if (input.changes.length === 0) {
    return [];
  }

  await ensureLiveInvalidationSchema(tx);
  const release = currentReleaseInfo();
  const written: LiveInvalidation[] = [];

  for (const change of input.changes) {
    for (const table of change.tables) {
      const revision = await nextRevision(tx);
      const payload = input.payload ?? {};
      const result = await tx.query(
        `INSERT INTO _forge_live_invalidations
          (revision, table_name, tenant_id, operation, source_kind, source_name, trace_id, release_id, deploy_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, created_at`,
        [
          revision,
          table,
          change.tenantId,
          change.operation ?? "write",
          input.sourceKind,
          input.sourceName ?? null,
          input.traceId ?? change.traceId ?? null,
          release.releaseId ?? null,
          release.deployId ?? null,
          JSON.stringify(payload),
        ],
      );

      written.push({
        id: Number(result.rows[0]?.id ?? written.length + 1),
        revision,
        tableName: table,
        tenantId: change.tenantId,
        operation: change.operation ?? "write",
        sourceKind: input.sourceKind,
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
        ...(input.traceId ?? change.traceId ? { traceId: input.traceId ?? change.traceId } : {}),
        ...(release.releaseId ? { releaseId: release.releaseId } : {}),
        ...(release.deployId ? { deployId: release.deployId } : {}),
        payload,
        createdAt: String(result.rows[0]?.created_at ?? new Date(0).toISOString()),
      });
    }
  }

  return written;
}

export async function notifyLiveWakeup(
  db: DbAdapter | DbTransaction,
  fromRevision: number,
): Promise<void> {
  try {
    await db.query(`SELECT pg_notify('forge_live', $1)`, [
      JSON.stringify({ fromRevision }),
    ]);
  } catch {
    // Wakeups are best-effort. The durable invalidation log is the source of truth.
  }
}

function parsePayload(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowToInvalidation(row: Record<string, unknown>): LiveInvalidation {
  return {
    id: Number(row.id),
    revision: Number(row.revision),
    tableName: String(row.table_name),
    tenantId: row.tenant_id === null || row.tenant_id === undefined ? null : String(row.tenant_id),
    operation: String(row.operation),
    sourceKind: String(row.source_kind),
    ...(row.source_name ? { sourceName: String(row.source_name) } : {}),
    ...(row.trace_id ? { traceId: String(row.trace_id) } : {}),
    ...(row.release_id ? { releaseId: String(row.release_id) } : {}),
    ...(row.deploy_id ? { deployId: String(row.deploy_id) } : {}),
    payload: parsePayload(row.payload),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function getLatestLiveRevision(db: DbAdapter): Promise<number> {
  await ensureLiveInvalidationSchema(db);
  const result = await db.query(
    "SELECT COALESCE(MAX(revision), 0) AS revision FROM _forge_live_invalidations",
  );
  const revision = Number(result.rows[0]?.revision ?? 0);
  return Number.isFinite(revision) ? revision : 0;
}

export async function readLiveInvalidations(
  db: DbAdapter,
  afterRevision = 0,
  limit = 100,
): Promise<LiveInvalidation[]> {
  await ensureLiveInvalidationSchema(db);
  const result = await db.query(
    `SELECT id, revision, table_name, tenant_id, operation, source_kind, source_name, trace_id, release_id, deploy_id, payload, created_at
     FROM _forge_live_invalidations
     WHERE revision > $1
     ORDER BY revision ASC
     LIMIT $2`,
    [afterRevision, limit],
  );
  return result.rows.map(rowToInvalidation);
}

export async function listLiveInvalidations(
  db: DbAdapter,
  limit = 50,
): Promise<LiveInvalidation[]> {
  await ensureLiveInvalidationSchema(db);
  const result = await db.query(
    `SELECT id, revision, table_name, tenant_id, operation, source_kind, source_name, trace_id, release_id, deploy_id, payload, created_at
     FROM _forge_live_invalidations
     ORDER BY revision ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(rowToInvalidation);
}
