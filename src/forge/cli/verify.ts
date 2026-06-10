import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { VerifyOptions, VerifyResult, VerifyStep } from "../compiler/types/cli.ts";
import { FORGE_VERIFY_POLICY } from "../compiler/diagnostics/codes.ts";
import { resolveBunExecutable } from "./bun-exec.ts";
import { runCheckCommand, runGenerateCommand } from "./commands.ts";
import { lintForgeGuards } from "./lint-forge.ts";
import { runPolicyCommand } from "./policy.ts";
import { runAuthCommand } from "./auth.ts";
import { runRlsCommand } from "./rls.ts";

interface PackageScripts {
  typecheck?: string;
  test?: string;
  lint?: string;
}

function readPackageScripts(workspaceRoot: string): PackageScripts {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {};
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      scripts?: PackageScripts;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

async function spawnBunRun(
  workspaceRoot: string,
  scriptName: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const bun = resolveBunExecutable();

  return new Promise((resolve, reject) => {
    const child = spawn(bun, ["run", scriptName], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

async function runPackageScript(
  workspaceRoot: string,
  scriptName: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return spawnBunRun(workspaceRoot, scriptName);
}

function skippedStep(name: string, reason: string): VerifyStep {
  return {
    name,
    ok: true,
    skipped: true,
    skipReason: reason,
  };
}

export async function runVerifyCommand(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const steps: VerifyStep[] = [];
  const diagnostics: Diagnostic[] = [];
  const scripts = readPackageScripts(options.workspaceRoot);

  const generateCheck = await runGenerateCommand({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  steps.push({
    name: "generate-check",
    ok: generateCheck.exitCode === 0,
    exitCode: generateCheck.exitCode,
  });
  diagnostics.push(...generateCheck.errors, ...generateCheck.warnings);

  const forgeCheck = await runCheckCommand(options.workspaceRoot, {
    strictSecrets: options.strict,
  });
  steps.push({
    name: "forge-check",
    ok: forgeCheck.exitCode === 0,
    exitCode: forgeCheck.exitCode,
  });
  diagnostics.push(...forgeCheck.errors, ...forgeCheck.warnings);

  if (options.strict) {
    const policyCheck = await runPolicyCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      json: false,
      strictPolicies: true,
    });
    steps.push({
      name: "policy-check-strict",
      ok: policyCheck.exitCode === 0,
      exitCode: policyCheck.exitCode,
    });
    if (policyCheck.diagnostics) {
      diagnostics.push(...policyCheck.diagnostics);
    }
    if (policyCheck.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_VERIFY_POLICY,
          message: "forge policy check --strict-policies failed",
        }),
      );
    }

    const agentContractCheck = await runGenerateCommand({
      workspaceRoot: options.workspaceRoot,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    steps.push({
      name: "agent-contract-check",
      ok: agentContractCheck.exitCode === 0,
      exitCode: agentContractCheck.exitCode,
    });
    diagnostics.push(...agentContractCheck.errors, ...agentContractCheck.warnings);

    const authCheck = await runAuthCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      json: false,
    });
    steps.push({
      name: "auth-check",
      ok: authCheck.exitCode === 0,
      exitCode: authCheck.exitCode,
    });
    if (!authCheck.ok && authCheck.error) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: authCheck.error.code,
          message: authCheck.error.message,
        }),
      );
    }

    const rlsCheck = await runRlsCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      db: "pglite",
      json: false,
    });
    steps.push({
      name: "rls-check",
      ok: rlsCheck.exitCode === 0,
      exitCode: rlsCheck.exitCode,
    });
    diagnostics.push(...rlsCheck.diagnostics);
  }

  if (options.skipTypecheck) {
    steps.push(skippedStep("typecheck", "--skip-typecheck"));
  } else if (!scripts.typecheck) {
    steps.push(skippedStep("typecheck", "no typecheck script in package.json"));
  } else {
    const typecheck = await runPackageScript(options.workspaceRoot, "typecheck");
    steps.push({
      name: "typecheck",
      ok: typecheck.exitCode === 0,
      exitCode: typecheck.exitCode,
    });
    if (typecheck.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_VERIFY_TYPECHECK",
          message: "typecheck script failed",
        }),
      );
    }
  }

  if (options.skipTests) {
    steps.push(skippedStep("tests", "--skip-tests"));
  } else if (!scripts.test) {
    steps.push(skippedStep("tests", "no test script in package.json"));
  } else {
    const tests = await runPackageScript(options.workspaceRoot, "test");
    steps.push({
      name: "tests",
      ok: tests.exitCode === 0,
      exitCode: tests.exitCode,
    });
    if (tests.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_VERIFY_TESTS",
          message: "test script failed",
        }),
      );
    }
  }

  if (options.skipEslint) {
    steps.push(skippedStep("eslint", "--skip-eslint"));
  } else {
    const lint = await lintForgeGuards(options.workspaceRoot);
    steps.push({
      name: "eslint",
      ok: lint.exitCode === 0,
      exitCode: lint.exitCode,
    });
    diagnostics.push(...lint.diagnostics);
  }

  const ok = steps.every((step) => step.ok);
  return {
    ok,
    steps,
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}
