import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDbCommand } from "../../src/forge/cli/db.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("db cli", () => {
  test(
    "migrate tolerates legacy sqlPlan without diagnostics",
    async () => {
      const workspace = tempWorkspace("db-cli-legacy-plan");
      try {
        mkdirSync(join(workspace, GENERATED_DIR), { recursive: true });
        const appGraph = await buildAppGraph({
          workspaceRoot: fixtureWorkspaceRoot(),
          sources: [fixtureSource("object-config.ts")],
        });
        const plan = buildSqlPlan(buildDataGraph(appGraph)) as unknown as Record<
          string,
          unknown
        >;
        delete plan.diagnostics;

        const sqlPlanPath = join(workspace, GENERATED_DIR, "sqlPlan.json");
        writeFileSync(sqlPlanPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

        const migrated = await runDbCommand({
          subcommand: "migrate",
          workspaceRoot: workspace,
          db: "memory",
          json: true,
        });

        expect(migrated.exitCode).toBe(0);
        expect(migrated.ok).toBe(true);
        expect(migrated.diagnostics).toEqual([]);
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    15_000,
  );

  test(
    "doctor inspects pglite columns through pg_catalog",
    async () => {
      const workspace = tempWorkspace("db-cli-pglite-doctor");
      try {
        mkdirSync(join(workspace, GENERATED_DIR), { recursive: true });
        const appGraph = await buildAppGraph({
          workspaceRoot: fixtureWorkspaceRoot(),
          sources: [fixtureSource("object-config.ts")],
        });
        const plan = buildSqlPlan(buildDataGraph(appGraph));
        writeFileSync(
          join(workspace, GENERATED_DIR, "sqlPlan.json"),
          `${JSON.stringify(plan, null, 2)}\n`,
          "utf8",
        );

        const migrated = await runDbCommand({
          subcommand: "migrate",
          workspaceRoot: workspace,
          db: "pglite",
          json: true,
        });
        expect(migrated.exitCode).toBe(0);

        const doctor = await runDbCommand({
          subcommand: "doctor",
          workspaceRoot: workspace,
          db: "pglite",
          json: true,
        });
        expect(doctor.exitCode).toBe(0);
        expect(doctor.ok).toBe(true);
        expect(JSON.stringify(doctor.data)).toContain("tickets");
      } finally {
        cleanupWorkspace(workspace);
      }
    },
    20_000,
  );
});
