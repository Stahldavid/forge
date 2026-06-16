import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import type { AuthCommandResult } from "./auth.ts";
import { runAuthCommand } from "./auth.ts";
import type { RlsCommandResult } from "./rls.ts";
import { runRlsCommand } from "./rls.ts";
import type { SecretsCommandResult } from "./secrets.ts";
import { runSecretsCommand } from "./secrets.ts";
import type { AiCommandResult } from "./ai.ts";
import { runAiCommand } from "./ai.ts";
import { runCheckCommand } from "./commands.ts";
import type { GenerateResult } from "../compiler/types/cli.ts";

export type SecuritySubcommand = "prove";

export interface SecurityCommandOptions {
  subcommand: SecuritySubcommand;
  workspaceRoot: string;
  json: boolean;
  db: DbAdapterKind;
  databaseUrl?: string;
}

export interface SecurityProofResult {
  ok: boolean;
  schemaVersion: "0.1.0";
  kind: "security-proof";
  assurance: "structural-only" | "postgres-proved";
  proofs: {
    forgeCheck: GenerateResult;
    auth: AuthCommandResult;
    secrets: SecretsCommandResult;
    rls: RlsCommandResult;
    agentRedteam: AiCommandResult;
  };
  summary: {
    passed: string[];
    failed: string[];
    warnings: string[];
  };
  exitCode: 0 | 1;
}

function passed(name: string, ok: boolean, summary: SecurityProofResult["summary"]): void {
  if (ok) {
    summary.passed.push(name);
  } else {
    summary.failed.push(name);
  }
}

export async function runSecurityCommand(
  options: SecurityCommandOptions,
): Promise<SecurityProofResult> {
  const forgeCheck = await runCheckCommand(options.workspaceRoot, { strictSecrets: true });
  const auth = await runAuthCommand({
    subcommand: "prove",
    workspaceRoot: options.workspaceRoot,
    json: true,
  });
  const secrets = await runSecretsCommand({
    subcommand: "prove",
    workspaceRoot: options.workspaceRoot,
    json: true,
    redacted: true,
  });
  const rls = await runRlsCommand({
    subcommand: "test",
    workspaceRoot: options.workspaceRoot,
    db: options.db,
    databaseUrl: options.databaseUrl,
    json: true,
  });
  const agentRedteam = await runAiCommand({
    subcommand: "redteam",
    workspaceRoot: options.workspaceRoot,
    json: true,
  });

  const summary: SecurityProofResult["summary"] = {
    passed: [],
    failed: [],
    warnings: [],
  };
  passed("forge-check", forgeCheck.exitCode === 0, summary);
  passed("auth-proof", auth.exitCode === 0, summary);
  passed("secrets-proof", secrets.exitCode === 0, summary);
  passed("rls-proof", rls.exitCode === 0, summary);
  passed("agent-redteam", agentRedteam.exitCode === 0, summary);

  if (auth.mode === "dev-headers") {
    summary.warnings.push("auth-proof uses local-only dev-headers mode");
  }
  for (const diagnostic of rls.diagnostics) {
    if (diagnostic.severity === "warning") {
      summary.warnings.push(`${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  for (const diagnostic of agentRedteam.diagnostics ?? []) {
    if (diagnostic.severity === "warning") {
      summary.warnings.push(`${diagnostic.code}: ${diagnostic.message}`);
    }
  }

  const ok = summary.failed.length === 0;
  const assurance =
    options.db === "postgres" &&
    rls.exitCode === 0 &&
    Boolean((rls.data as { skipped?: boolean } | undefined)?.skipped) === false
      ? "postgres-proved"
      : "structural-only";
  return {
    ok,
    schemaVersion: "0.1.0",
    kind: "security-proof",
    assurance,
    proofs: {
      forgeCheck,
      auth,
      secrets,
      rls,
      agentRedteam,
    },
    summary,
    exitCode: ok ? 0 : 1,
  };
}

export function formatSecurityJson(result: SecurityProofResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatSecurityHuman(result: SecurityProofResult): string {
  const lines = [
    "Forge Security Proof",
    "",
    `Status: ${result.ok ? "ok" : "failed"}`,
    `Assurance: ${result.assurance}`,
    `Passed: ${result.summary.passed.join(", ") || "none"}`,
    `Failed: ${result.summary.failed.join(", ") || "none"}`,
  ];
  if (result.summary.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.summary.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join("\n")}\n`;
}
