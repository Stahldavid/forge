import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runAuthCommand } from "../../src/forge/cli/auth.ts";
import { runSecretsCommand } from "../../src/forge/cli/secrets.ts";
import { runSecurityCommand } from "../../src/forge/cli/security.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";

describe("security assurance: prove commands", () => {
  test("parseCli accepts prove commands", () => {
    expect(parseCli(["auth", "prove", "--json"]).errors).toEqual([]);
    expect(parseCli(["secrets", "prove", "--json"]).errors).toEqual([]);
    const parsed = parseCli(["security", "prove", "--db", "postgres", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "security",
      subcommand: "prove",
      db: "postgres",
    });
  });

  test("auth prove reports local-only dev headers without leaking token data", async () => {
    const workspace = scaffoldGenerateWorkspace("security-auth-prove");
    try {
      await run(defaultGenerateOptions(workspace));
      const result = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        kind: "auth-proof",
        productionReady: false,
      });
      expect(JSON.stringify(result.data)).toContain("local-only");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("secrets prove returns redacted evidence", async () => {
    const workspace = scaffoldGenerateWorkspace("security-secrets-prove");
    try {
      await run(defaultGenerateOptions(workspace));
      const result = await runSecretsCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        redacted: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        kind: "secrets-proof",
        ok: true,
      });
      expect(JSON.stringify(result.data)).not.toContain("process.env");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("security prove aggregates forge, auth, secrets, and rls evidence", async () => {
    const workspace = scaffoldGenerateWorkspace("security-prove");
    try {
      await run(defaultGenerateOptions(workspace));
      const result = await runSecurityCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        db: "pglite",
      });
      expect(result.exitCode).toBe(0);
      expect(result.kind).toBe("security-proof");
      expect(result.assurance).toBe("structural-only");
      expect(result.summary.passed).toContain("forge-check");
      expect(result.summary.passed).toContain("auth-proof");
      expect(result.summary.passed).toContain("secrets-proof");
      expect(result.summary.passed).toContain("rls-proof");
      expect(result.summary.passed).toContain("agent-redteam");
      expect(result.proofs.rls.data).toMatchObject({
        skipped: true,
      });
      expect(result.proofs.agentRedteam.data).toMatchObject({
        kind: "agent-redteam",
        ok: true,
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 60_000);
});
