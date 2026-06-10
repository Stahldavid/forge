import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runVerifyCommand } from "../../src/forge/cli/commands.ts";
import { runRlsCommand } from "../../src/forge/cli/rls.ts";
import {
  dbSessionContextFromAuth,
  setDbSessionContext,
} from "../../src/forge/runtime/db/session-context.ts";
import type { DbTransaction } from "../../src/forge/runtime/db/adapter.ts";
import { scaffoldPolicyWorkspace, cleanupWorkspace } from "../policy/helpers.ts";

const GENERATED = "src/forge/_generated";

function readBody(root: string, relative: string): string {
  return stripDeterministicHeader(readFileSync(join(root, relative), "utf8"));
}

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(readBody(root, relative)) as T;
}

describe("H21 Postgres RLS compiler", () => {
  test("generates SQL, policy manifest, security manifest, and session context", async () => {
    const workspace = await scaffoldPolicyWorkspace("h21-generation");
    try {
      for (const artifact of [
        "rlsPolicies.sql",
        "rlsPolicies.json",
        "rlsPolicies.ts",
        "dbSecurityManifest.json",
        "dbSecurityManifest.ts",
        "dbSessionContext.json",
        "dbSessionContext.ts",
      ]) {
        expect(existsSync(join(workspace.root, GENERATED, artifact))).toBe(true);
      }

      const sql = readBody(workspace.root, `${GENERATED}/rlsPolicies.sql`);
      expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS forge");
      expect(sql).toContain("forge.current_tenant_id()");
      expect(sql).toContain('ALTER TABLE "tickets" ENABLE ROW LEVEL SECURITY');
      expect(sql).toContain('ALTER TABLE "tickets" FORCE ROW LEVEL SECURITY');
      expect(sql).toContain('CREATE POLICY "forge_tickets_select"');
      expect(sql).toContain('WITH CHECK ("tenant_id" = forge.current_tenant_id())');

      const policies = readJson<{
        tables: Array<{ table: string; policies: unknown[]; tenantType: string }>;
      }>(workspace.root, `${GENERATED}/rlsPolicies.json`);
      expect(policies.tables.find((table) => table.table === "tickets")?.policies.length).toBe(4);
      expect(policies.tables.find((table) => table.table === "tickets")?.tenantType).toBe("uuid");

      const session = readJson<{ settings: Array<{ name: string }> }>(
        workspace.root,
        `${GENERATED}/dbSessionContext.json`,
      );
      expect(session.settings.map((setting) => setting.name)).toContain("forge.tenant_id");
    } finally {
      cleanupWorkspace(workspace.root);
    }
  }, 30_000);

  test("rls check is structural on pglite and reports generated artifacts", async () => {
    const workspace = await scaffoldPolicyWorkspace("h21-cli");
    try {
      const result = await runRlsCommand({
        subcommand: "check",
        workspaceRoot: workspace.root,
        db: "pglite",
        json: true,
      });

      expect(result.exitCode).toBe(0);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_RLS_PGLITE_NOT_AUTHORITATIVE")).toBe(true);
      expect((result.data as { artifacts: string[] }).artifacts).toContain(
        `${GENERATED}/rlsPolicies.sql`,
      );
    } finally {
      cleanupWorkspace(workspace.root);
    }
  }, 30_000);

  test("session context uses transaction-scoped set_config values", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const tx: DbTransaction = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      commit: async () => {},
      rollback: async () => {},
    };

    await setDbSessionContext(tx, {
      kind: "user",
      userId: "user-1",
      tenantId: "11111111-1111-1111-1111-111111111111",
      roles: ["member"],
      permissions: ["tickets.read"],
    });

    expect(dbSessionContextFromAuth({ kind: "anonymous" })[0]).toEqual({
      name: "forge.tenant_id",
      value: "",
    });
    expect(calls.every((call) => call.sql === "SELECT set_config($1, $2, true)")).toBe(true);
    expect(calls.map((call) => call.params?.[0])).toContain("forge.tenant_id");
    expect(calls.find((call) => call.params?.[0] === "forge.roles")?.params?.[1]).toBe(
      JSON.stringify(["member"]),
    );
  });

  test("parseCli accepts rls commands and verify strict includes rls-check", async () => {
    expect(parseCli(["rls", "generate"]).command).toMatchObject({
      kind: "rls",
      subcommand: "generate",
    });
    expect(parseCli(["rls", "apply", "--db", "postgres"]).command).toMatchObject({
      kind: "rls",
      subcommand: "apply",
      db: "postgres",
    });
    expect(parseCli(["db", "rls-check"]).command).toMatchObject({
      kind: "db",
      subcommand: "rls-check",
    });

    const workspace = await scaffoldPolicyWorkspace("h21-verify");
    try {
      const verified = await runVerifyCommand({
        workspaceRoot: workspace.root,
        json: false,
        skipTests: true,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
      });
      expect(verified.steps.some((step) => step.name === "rls-check")).toBe(true);
    } finally {
      cleanupWorkspace(workspace.root);
    }
  }, 30_000);
});
