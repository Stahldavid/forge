import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDbCommand } from "../../src/forge/cli/db.ts";
import { runPgliteDoctorCommand } from "../../src/forge/cli/doctor.ts";
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

  test("repair reports missing local pglite store as no-op", async () => {
    const workspace = tempWorkspace("db-cli-pglite-repair-missing");
    try {
      const repaired = await runDbCommand({
        subcommand: "repair",
        workspaceRoot: workspace,
        db: "pglite",
        local: true,
        json: true,
      });

      expect(repaired.exitCode).toBe(0);
      expect(repaired.ok).toBe(true);
      expect(JSON.stringify(repaired.data)).toContain("\"repaired\":false");
      expect(JSON.stringify(repaired.data)).toContain("\"state\":\"missing\"");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("repair requires explicit local flag", async () => {
    const workspace = tempWorkspace("db-cli-pglite-repair-local-required");
    try {
      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
      const repaired = await runDbCommand({
        subcommand: "repair",
        workspaceRoot: workspace,
        db: "pglite",
        json: true,
      });

      expect(repaired.exitCode).toBe(1);
      expect(repaired.ok).toBe(false);
      expect(repaired.diagnostics[0]?.code).toBe("FORGE_CLI_USAGE");
      expect(repaired.diagnostics[0]?.suggestedCommands).toContain("node bin/forge.mjs db repair --local --adapter pglite --json");
      expect(JSON.stringify(repaired.data)).toContain("\"local\":false");
      expect(JSON.stringify(repaired.data)).not.toContain("\"forge db repair");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("repair refuses active local pglite store", async () => {
    const workspace = tempWorkspace("db-cli-pglite-repair-active");
    try {
      const dataDir = join(workspace, ".forge", "pglite");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, "postmaster.pid"), `${process.pid}\n`, "utf8");

      const repaired = await runDbCommand({
        subcommand: "repair",
        workspaceRoot: workspace,
        db: "pglite",
        local: true,
        json: true,
      });

      expect(repaired.exitCode).toBe(1);
      expect(repaired.ok).toBe(false);
      expect(repaired.diagnostics[0]?.code).toBe("FORGE_PGLITE_STORE_ACTIVE");
      expect(JSON.stringify(repaired.data)).toContain("\"state\":\"active\"");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("pglite doctor reports active local store as warning", async () => {
    const workspace = tempWorkspace("db-cli-pglite-doctor-active");
    try {
      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
      const dataDir = join(workspace, ".forge", "pglite");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(join(dataDir, "postmaster.pid"), `${process.pid}\n`, "utf8");

      const doctor = await runPgliteDoctorCommand({ workspaceRoot: workspace });

      expect(doctor.exitCode).toBe(0);
      expect(doctor.ok).toBe(true);
      expect(doctor.inspection.state).toBe("active");
      expect(doctor.nextActions).toContain("node bin/forge.mjs doctor pglite --json");
      expect(doctor.inspection.nextActions).toContain("node bin/forge.mjs doctor pglite --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
