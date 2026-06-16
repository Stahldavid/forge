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

export interface SecurityInvariantEvidence {
  id: string;
  artifact: string;
  level: "checked" | "tested" | "proved";
  summary: string;
  tests: string[];
  commands: string[];
}

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
    rlsMutation: RlsCommandResult;
    agentRedteam: AiCommandResult;
  };
  evidence: {
    invariants: SecurityInvariantEvidence[];
  };
  summary: {
    passed: string[];
    failed: string[];
    warnings: string[];
  };
  exitCode: 0 | 1;
}

function invariantEvidence(): SecurityInvariantEvidence[] {
  return [
    {
      id: "INV-001",
      artifact: "auth-negative",
      level: "tested",
      summary: "Production auth rejects invalid JWT/OIDC tokens and ignores dev headers in jwt mode.",
      tests: ["tests/security/auth-negative.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/auth-negative.test.ts --timeout 120000"],
    },
    {
      id: "INV-002",
      artifact: "tenant-isolation",
      level: "tested",
      summary: "Runtime and HTTP APIs block cross-tenant reads, writes, tenant spoofing, and unsafe tenant filters.",
      tests: [
        "tests/security/tenant-isolation/runtime-api.test.ts",
        "tests/security/tenant-isolation/http-runtime.test.ts",
      ],
      commands: ["node ./bin/forge-bun.mjs test tests/security/tenant-isolation --timeout 120000"],
    },
    {
      id: "INV-003",
      artifact: "rls-test",
      level: "proved",
      summary: "Postgres RLS probes and structural mutation checks protect tenant-scoped tables.",
      tests: [
        "tests/security/rls-postgres-adversarial.test.ts",
        "tests/security/rls-mutation.test.ts",
      ],
      commands: [
        "node ./bin/forge.mjs rls test --db postgres --json",
        "node ./bin/forge.mjs rls mutate-test --json",
      ],
    },
    {
      id: "INV-004",
      artifact: "runtime-boundaries",
      level: "tested",
      summary: "Commands reject forbidden AI, agent, network, secret, filesystem, and process.env usage.",
      tests: ["tests/security/runtime-boundaries.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/runtime-boundaries.test.ts --timeout 120000"],
    },
    {
      id: "INV-005",
      artifact: "runtime-boundaries",
      level: "tested",
      summary: "Queries and liveQueries remain read-only and side-effect free.",
      tests: ["tests/security/runtime-boundaries.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/runtime-boundaries.test.ts --timeout 120000"],
    },
    {
      id: "INV-006",
      artifact: "agent-tools",
      level: "tested",
      summary: "Generated agent tools carry Forge auth, tenant, policy, runtime, and risk metadata.",
      tests: ["tests/security/agent-tools.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/agent-tools.test.ts --timeout 120000"],
    },
    {
      id: "INV-007",
      artifact: "agent-tools",
      level: "tested",
      summary: "Write, destructive, and external agent tools require approval metadata.",
      tests: ["tests/security/agent-tools.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/agent-tools.test.ts --timeout 120000"],
    },
    {
      id: "INV-008",
      artifact: "secret-redaction",
      level: "tested",
      summary: "Generated artifacts and telemetry scrub secret names and known secret values.",
      tests: ["tests/security/secret-redaction.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/secret-redaction.test.ts --timeout 120000"],
    },
    {
      id: "INV-009",
      artifact: "webhooks",
      level: "tested",
      summary: "Webhook helpers reject invalid signatures, stale timestamps, tampered payloads, and replayed event IDs.",
      tests: ["tests/security/webhooks/webhook-security.test.ts"],
      commands: ["node ./bin/forge-bun.mjs test tests/security/webhooks --timeout 120000"],
    },
    {
      id: "INV-010",
      artifact: "release-supply-chain",
      level: "checked",
      summary: "Release workflow uses Trusted Publishing, provenance, smoke tests, security proof, and generated release evidence.",
      tests: ["tests/ci/publish-workflow.test.ts"],
      commands: ["npm run release:smoke", "npm run release:evidence"],
    },
  ];
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
  const rlsMutation = await runRlsCommand({
    subcommand: "mutate-test",
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
  passed("rls-mutation-proof", rlsMutation.exitCode === 0, summary);
  passed("agent-redteam", agentRedteam.exitCode === 0, summary);

  if (auth.mode === "dev-headers") {
    summary.warnings.push("auth-proof uses local-only dev-headers mode");
  }
  for (const diagnostic of rls.diagnostics) {
    if (diagnostic.severity === "warning") {
      summary.warnings.push(`${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  for (const diagnostic of rlsMutation.diagnostics) {
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
      rlsMutation,
      agentRedteam,
    },
    evidence: {
      invariants: invariantEvidence(),
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
