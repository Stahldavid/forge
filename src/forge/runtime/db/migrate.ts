import type { SqlPlan } from "../../compiler/data-graph/sql/types.ts";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_DB_MIGRATION_FAILED } from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { DbAdapter } from "./adapter.ts";

export interface MigrationRecord {
  id: string;
  checksum: string;
  applied_at: string;
}

export interface MigrationStatus {
  applied: MigrationRecord[];
  pending: string[];
}

export interface SqlPlanDiff {
  addedTables: string[];
  removedTables: string[];
  checksumChanged: boolean;
  currentChecksum: string;
  appliedChecksum: string | null;
}

function allChanges(plan: SqlPlan): string[] {
  return [
    ...plan.systemTables.map((change) => change.sql),
    ...plan.tables.map((change) => change.sql),
    ...plan.indexes.map((change) => change.sql),
  ];
}

export async function applyMigrations(
  adapter: DbAdapter,
  sqlPlan: SqlPlan,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  try {
    for (const sql of allChanges(sqlPlan)) {
      await adapter.query(sql);
    }

    await adapter.query(
      `INSERT INTO _forge_migrations (id, checksum) VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()`,
      [sqlPlan.migrationId, sqlPlan.checksum],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "migration failed";
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_MIGRATION_FAILED,
        message,
      }),
    );
  }

  return diagnostics;
}

export async function resetDatabase(
  adapter: DbAdapter,
  sqlPlan: SqlPlan,
): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];

  try {
    for (const change of [...sqlPlan.tables].reverse()) {
      if (change.table) {
        await adapter.query(`DROP TABLE IF EXISTS "${change.table}" CASCADE`);
      }
    }

    await adapter.query(`TRUNCATE TABLE _forge_migrations`);
    await adapter.query(`TRUNCATE TABLE _forge_workflow_steps RESTART IDENTITY CASCADE`);
    await adapter.query(`TRUNCATE TABLE _forge_workflow_runs RESTART IDENTITY CASCADE`);
    await adapter.query(`TRUNCATE TABLE _forge_outbox_deliveries RESTART IDENTITY CASCADE`);
    await adapter.query(`TRUNCATE TABLE _forge_outbox RESTART IDENTITY CASCADE`);

    diagnostics.push(...(await applyMigrations(adapter, sqlPlan)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "database reset failed";
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_DB_MIGRATION_FAILED,
        message,
      }),
    );
  }

  return diagnostics;
}

export async function getMigrationStatus(adapter: DbAdapter): Promise<MigrationStatus> {
  const result = await adapter.query(
    `SELECT id, checksum, applied_at::text AS applied_at FROM _forge_migrations ORDER BY applied_at ASC`,
  );

  const applied = result.rows.map((row) => ({
    id: String(row.id),
    checksum: String(row.checksum),
    applied_at: String(row.applied_at),
  }));

  return {
    applied,
    pending: [],
  };
}

export function diffSqlPlan(current: SqlPlan, appliedChecksum: string | null): SqlPlanDiff {
  const currentTables = current.tables
    .map((change) => change.table)
    .filter((table): table is string => table !== undefined)
    .sort();

  return {
    addedTables: currentTables,
    removedTables: [],
    checksumChanged: appliedChecksum !== null && appliedChecksum !== current.checksum,
    currentChecksum: current.checksum,
    appliedChecksum: appliedChecksum,
  };
}
