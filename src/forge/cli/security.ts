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
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
  runTests: boolean;
}

export interface SecurityTestRunResult {
  enabled: boolean;
  ok: boolean;
  command: string[];
  tests: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
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
    securityTests: SecurityTestRunResult;
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

function securityTestFiles(options: SecurityCommandOptions): string[] {
  const tests = new Set<string>();
  for (const invariant of invariantEvidence()) {
    for (const test of invariant.tests) {
      if (!test.startsWith("tests/security/")) {
        continue;
      }
      if (options.db !== "postgres" && test.includes("rls-postgres-adversarial.test.ts")) {
        continue;
      }
      tests.add(test);
    }
  }
  return [...tests].sort();
}

function runSecurityTests(options: SecurityCommandOptions): SecurityTestRunResult {
  const tests = securityTestFiles(options);
  const command = [
    "./bin/forge-bun.mjs",
    "test",
    ...tests,
    "--timeout",
    "120000",
  ];

  if (!options.runTests) {
    return {
      enabled: false,
      ok: true,
      command: ["node", ...command],
      tests,
      exitCode: null,
      stdout: "",
      stderr: "",
    };
  }

  const missingTests = tests.filter((test) => !existsSync(join(options.workspaceRoot, test)));
  const runnerPath = join(options.workspaceRoot, "bin", "forge-bun.mjs");
  if (missingTests.length > 0 || !existsSync(runnerPath)) {
    return {
      enabled: false,
      ok: true,
      command: ["node", ...command],
      tests,
      exitCode: null,
      stdout: "",
      stderr:
        "security invariant test fixtures are not available in this workspace; structural proofs still ran. Run this command from the ForgeOS source checkout to execute the full framework test fixtures.",
    };
  }

  const result = spawnSync(process.execPath, command, {
    cwd: options.workspaceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.databaseUrl ? { DATABASE_URL: options.databaseUrl } : {}),
    },
    windowsHide: true,
  });

  return {
    enabled: true,
    ok: result.status === 0,
    command: ["node", ...command],
    tests,
    exitCode: result.status,
    stdout: limitOutput(result.stdout ?? ""),
    stderr: limitOutput(result.stderr ?? ""),
  };
}

function limitOutput(output: string): string {
  const maxLength = 20_000;
  if (output.length <= maxLength) {
    return output;
  }
  return `${output.slice(0, 4_000)}\n\n[forge output truncated]\n\n${output.slice(-16_000)}`;
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
  const securityTests = runSecurityTests(options);

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
  if (securityTests.enabled) {
    passed("security-tests", securityTests.ok, summary);
  }

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
  if (!securityTests.enabled && !options.runTests) {
    summary.warnings.push("security-tests not executed; pass --full or --run-tests to run invariant security tests");
  }
  if (!securityTests.enabled && options.runTests) {
    summary.warnings.push(securityTests.stderr);
  }
  if (options.runTests && options.db !== "postgres") {
    summary.warnings.push("postgres RLS adversarial test skipped because --db postgres was not selected");
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
      securityTests,
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
    `Security tests: ${result.proofs.securityTests.enabled ? (result.proofs.securityTests.ok ? "passed" : "failed") : "not run"}`,
  ];
  if (result.summary.warnings.length > 0) {
    lines.push("", "Warnings:", ...result.summary.warnings.map((warning) => `- ${warning}`));
  }
  return `${lines.join("\n")}\n`;
}
