import { describe, expect, test } from "bun:test";
import { runRlsCommand } from "../../src/forge/cli/rls.ts";
import { cleanupWorkspace, scaffoldPolicyWorkspace } from "../policy/helpers.ts";

const postgresTest = process.env.DATABASE_URL ? test : test.skip;

describe("security assurance: postgres RLS adversarial probes", () => {
  postgresTest("forge rls test proves tenant isolation in a real Postgres database", async () => {
    const workspace = await scaffoldPolicyWorkspace("security-rls-postgres");
    try {
      const result = await runRlsCommand({
        subcommand: "test",
        workspaceRoot: workspace.root,
        db: "postgres",
        databaseUrl: process.env.DATABASE_URL,
        json: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);

      const data = result.data as {
        appliedStatements: number;
        role: string | null;
        probes: Array<{
          table: string;
          tenantAVisible: number;
          tenantBVisible: number;
          unscopedVisible: number;
          crossTenantUpdateBlocked: boolean;
          crossTenantDeleteBlocked: boolean;
          mismatchedInsertBlocked: boolean;
        }>;
      };
      expect(data.appliedStatements).toBeGreaterThan(0);
      expect(data.role).toBe("forge_rls_probe");

      const tickets = data.probes.find((probe) => probe.table === "tickets");
      expect(tickets).toBeDefined();
      expect(tickets?.tenantAVisible).toBe(1);
      expect(tickets?.tenantBVisible).toBe(1);
      expect(tickets?.unscopedVisible).toBe(0);
      expect(tickets?.crossTenantUpdateBlocked).toBe(true);
      expect(tickets?.crossTenantDeleteBlocked).toBe(true);
      expect(tickets?.mismatchedInsertBlocked).toBe(true);
    } finally {
      cleanupWorkspace(workspace.root);
    }
  }, 120_000);
});
