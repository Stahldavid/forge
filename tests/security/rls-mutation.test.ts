import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_RLS_MUTATION_FAILED } from "../../src/forge/compiler/diagnostics/codes.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { runRlsCommand } from "../../src/forge/cli/rls.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("security assurance: RLS mutation checks", () => {
  test("mutate-test kills unsafe generated RLS mutations", async () => {
    const workspace = scaffoldGenerateWorkspace("security-rls-mutation");
    writeFileSync(
      join(workspace, "src", "forge", "schema.ts"),
      `
        import { defineTable } from "forge/server";
        export const tickets = defineTable({
          name: "tickets",
          fields: {
            id: "uuid",
            tenantId: "text",
            title: "text",
            status: "text",
          },
        });
      `,
      "utf8",
    );
    writeFileSync(
      join(workspace, "src", "policies.ts"),
      `
        import { canRole, definePolicies } from "forge/policy";
        export const policies = definePolicies({
          "tickets.read": canRole("owner", "admin", "member"),
          "tickets.create": canRole("owner", "admin", "member"),
          "tickets.update": canRole("owner", "admin", "member"),
          "tickets.delete": canRole("owner", "admin", "member"),
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const result = await runRlsCommand({
        subcommand: "mutate-test",
        workspaceRoot: workspace,
        db: "pglite",
        json: true,
      });

      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === FORGE_RLS_MUTATION_FAILED)).toBe(false);
      const data = result.data as { mutations: Array<{ killed: boolean }> };
      expect(data.mutations.length).toBeGreaterThanOrEqual(5);
      expect(data.mutations.every((mutation) => mutation.killed)).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
