import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { VerifyOptions, VerifyProfile, VerifyResult, VerifyStep } from "../compiler/types/cli.ts";
import {
  FORGE_VERIFY_POLICY,
  FORGE_VERIFY_SCRIPT_TIMEOUT,
} from "../compiler/diagnostics/codes.ts";
import { detectPackageManager } from "../compiler/package-manager/detect.ts";
import { resolvePackageManagerArgv } from "../compiler/package-manager/executor.ts";
import { runCheckCommand, runGenerateCommand } from "./commands.ts";
import { lintForgeGuards } from "./lint-forge.ts";
import { runPolicyCommand } from "./policy.ts";
import { runAuthCommand } from "./auth.ts";
import { runRlsCommand } from "./rls.ts";
import { buildImpactTestPlan, diagnosticsForImpactTestRun, runImpactTestPlan } from "../impact/index.ts";
import { runAgentCheck } from "../agent-adapters/index.ts";
import type { AgentAdapterTarget } from "../agent-adapters/types.ts";

interface PackageScripts {
  typecheck?: string;
  test?: string;
  lint?: string;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 30 * 60 * 1000;

function readPackageScripts(workspaceRoot: string): PackageScripts {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return {};
  }

  try {
    const pkg = JSON.parse((nodeFileSystem.readText(packageJsonPath) ?? "")) as {
      scripts?: PackageScripts;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

async function spawnPackageRun(
  workspaceRoot: string,
  scriptName: string,
  timeoutMs: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  durationMs: number;
  timedOut: boolean;
}> {
  const packageManager = detectPackageManager(workspaceRoot);
  const argv = resolvePackageManagerArgv([packageManager, "run", scriptName]);
  const started = Date.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: timedOut ? 1 : code ?? 1,
          stdout,
          stderr,
          command: argv.join(" "),
          durationMs: Date.now() - started,
          timedOut,
        });
      }
    });
  });
}

async function runPackageScript(
  workspaceRoot: string,
  scriptName: string,
  timeoutMs: number,
): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  durationMs: number;
  timedOut: boolean;
}> {
  return spawnPackageRun(workspaceRoot, scriptName, timeoutMs);
}

function skippedStep(name: string, reason: string): VerifyStep {
  return {
    name,
    ok: true,
    skipped: true,
    skipReason: reason,
  };
}

function resolveScriptTimeoutMs(options: VerifyOptions): number {
  if (options.scriptTimeoutMs && Number.isFinite(options.scriptTimeoutMs)) {
    return options.scriptTimeoutMs;
  }
  const fromEnv = process.env.FORGE_VERIFY_SCRIPT_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_SCRIPT_TIMEOUT_MS;
}

function printProgress(options: VerifyOptions, message: string): void {
  if (!options.json) {
    console.error(message);
  }
}

function timedOutDiagnostic(scriptName: string, timeoutMs: number): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: FORGE_VERIFY_SCRIPT_TIMEOUT,
    message: `${scriptName} script timed out after ${timeoutMs}ms`,
    suggestedCommands: [
      `forge verify --skip-tests --skip-eslint --script-timeout-ms ${timeoutMs}`,
      "forge test plan --changed --json",
      "forge verify --changed",
    ],
  });
}

function resolveVerifyProfile(options: VerifyOptions): VerifyProfile {
  if (options.changed) {
    return "changed";
  }
  if (options.fast || options.smoke) {
    return "smoke";
  }
  if (options.strict) {
    return "strict";
  }
  if (options.standard) {
    return "standard";
  }
  return "default";
}

async function runStandardImpactTests(
  options: VerifyOptions,
): Promise<{ steps: VerifyStep[]; diagnostics: Diagnostic[] }> {
  const started = Date.now();
  const diagnostics: Diagnostic[] = [];
  const steps: VerifyStep[] = [];
  const plan = buildImpactTestPlan({
    subcommand: "run",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    write: false,
    changed: true,
    staged: false,
    maxCost: "standard",
    includeDocker: false,
    includeBrowser: false,
    bail: false,
  });
  const impactOnlyPlan = {
    ...plan,
    requiredChecks: [],
  };
  const commands = impactOnlyPlan.tests.map((test) => test.command);

  if (commands.length === 0) {
    steps.push(skippedStep("impact-tests", "no changed files selected an impact test"));
    return { steps, diagnostics };
  }

  const record = await runImpactTestPlan(options.workspaceRoot, impactOnlyPlan, {
    bail: false,
    timeoutMs: resolveScriptTimeoutMs(options),
  });
  steps.push({
    name: "impact-tests",
    ok: record.failed.length === 0,
    exitCode: record.failed.length === 0 ? 0 : 1,
    command: "forge test run --changed --max-cost standard --json",
    durationMs: Date.now() - started,
  });
  if (record.failed.length > 0) {
    diagnostics.push(...diagnosticsForImpactTestRun(record));
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_VERIFY_TESTS",
        message: `impact-selected tests failed: ${record.failed.join(", ")}; inspect .forge/test-runs/last.json for command output`,
        suggestedCommands: [
          "forge test run --changed --max-cost standard --json",
          "forge repair diagnose --from-last-test-run --json",
          "forge verify --strict",
        ],
      }),
    );
  }
  return { steps, diagnostics };
}

export function configuredAgentTargets(workspaceRoot: string): AgentAdapterTarget[] {
  const targets: AgentAdapterTarget[] = [];
  if (nodeFileSystem.exists(join(workspaceRoot, ".forge/agent/context.json"))) {
    targets.push("generic");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, ".codex"))) {
    targets.push("codex");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, ".cursor"))) {
    targets.push("cursor");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, "CLAUDE.md")) || nodeFileSystem.exists(join(workspaceRoot, ".claude"))) {
    targets.push("claude");
  }
  return targets;
}

export async function runVerifyCommand(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const started = Date.now();
  const steps: VerifyStep[] = [];
  const diagnostics: Diagnostic[] = [];
  const scripts = readPackageScripts(options.workspaceRoot);
  const scriptTimeoutMs = resolveScriptTimeoutMs(options);
  const profile = resolveVerifyProfile(options);

  if (options.changed) {
    const plan = buildImpactTestPlan({
      subcommand: "run",
      workspaceRoot: options.workspaceRoot,
      json: options.json,
      write: false,
      changed: true,
      staged: false,
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
    });
    const record = await runImpactTestPlan(options.workspaceRoot, plan, {
      bail: false,
      timeoutMs: scriptTimeoutMs,
    });
    for (const result of record.results) {
      steps.push({
        name: result.command,
        ok: result.ok,
        exitCode: result.exitCode,
        command: result.command,
        durationMs: result.durationMs,
      });
    }
    if (record.failed.length > 0) {
      diagnostics.push(...diagnosticsForImpactTestRun(record));
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_VERIFY_CHANGED_INCOMPLETE",
          message: `impact-based verification failed: ${record.failed.join(", ")}; run forge test run --changed --json for details`,
        }),
      );
    }
    const ok = record.failed.length === 0;
    return { ok, profile, steps, diagnostics, durationMs: Date.now() - started, exitCode: ok ? 0 : 1 };
  }

  printProgress(options, "verify: generate-check");
  const generateStarted = Date.now();
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
    durationMs: Date.now() - generateStarted,
  });
  steps.push({
    name: "agent-contract-check",
    ok: generateCheck.exitCode === 0,
    exitCode: generateCheck.exitCode,
    durationMs: Date.now() - generateStarted,
  });
  diagnostics.push(...generateCheck.errors, ...generateCheck.warnings);

  printProgress(options, "verify: forge-check");
  const checkStarted = Date.now();
  const forgeCheck = await runCheckCommand(options.workspaceRoot, {
    strictSecrets: options.strict,
  });
  steps.push({
    name: "forge-check",
    ok: forgeCheck.exitCode === 0,
    exitCode: forgeCheck.exitCode,
    durationMs: Date.now() - checkStarted,
  });
  diagnostics.push(...forgeCheck.errors, ...forgeCheck.warnings);

  if (profile === "strict" || profile === "standard") {
    printProgress(options, "verify: policy-check-strict");
    const policyStarted = Date.now();
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
      durationMs: Date.now() - policyStarted,
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

    printProgress(options, "verify: auth-check");
    const authStarted = Date.now();
    const authCheck = await runAuthCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      json: false,
    });
    steps.push({
      name: "auth-check",
      ok: authCheck.exitCode === 0,
      exitCode: authCheck.exitCode,
      durationMs: Date.now() - authStarted,
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

    printProgress(options, "verify: rls-check");
    const rlsStarted = Date.now();
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
      durationMs: Date.now() - rlsStarted,
    });
    diagnostics.push(...rlsCheck.diagnostics);

    const agentTargets = configuredAgentTargets(options.workspaceRoot);
    if (agentTargets.length === 0) {
      steps.push(skippedStep("agent-adapter-check", "no agent adapter exports configured"));
    } else {
      for (const target of agentTargets) {
        const agentCheck = runAgentCheck({
          subcommand: "check",
          workspaceRoot: options.workspaceRoot,
          json: false,
          target,
          dryRun: false,
          force: false,
          preserveUserSections: true,
          skills: true,
          rules: true,
        });
        steps.push({
          name: `agent-adapter-check:${target}`,
          ok: agentCheck.exitCode === 0,
          exitCode: agentCheck.exitCode,
        });
        diagnostics.push(...agentCheck.diagnostics);
      }
    }
  }

  if (options.skipTypecheck) {
    steps.push(skippedStep("typecheck", "--skip-typecheck"));
  } else if (!scripts.typecheck) {
    steps.push(skippedStep("typecheck", "no typecheck script in package.json"));
  } else {
    printProgress(options, `verify: typecheck (${scriptTimeoutMs}ms timeout)`);
    const typecheck = await runPackageScript(options.workspaceRoot, "typecheck", scriptTimeoutMs);
    steps.push({
      name: "typecheck",
      ok: typecheck.exitCode === 0,
      exitCode: typecheck.exitCode,
      command: typecheck.command,
      durationMs: typecheck.durationMs,
      timedOut: typecheck.timedOut,
    });
    if (typecheck.timedOut) {
      diagnostics.push(timedOutDiagnostic("typecheck", scriptTimeoutMs));
    }
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

  if (profile === "smoke") {
    steps.push(skippedStep("tests", "--smoke/--fast"));
  } else if (options.skipTests) {
    steps.push(skippedStep("tests", "--skip-tests"));
  } else if (profile === "standard") {
    printProgress(options, "verify: impact-tests (standard profile)");
    const impact = await runStandardImpactTests(options);
    steps.push(...impact.steps);
    diagnostics.push(...impact.diagnostics);
    steps.push(skippedStep("tests", "--standard uses impact-selected tests; use --strict for the full test script"));
  } else if (!scripts.test) {
    steps.push(skippedStep("tests", "no test script in package.json"));
  } else {
    printProgress(options, `verify: tests (${scriptTimeoutMs}ms timeout)`);
    const tests = await runPackageScript(options.workspaceRoot, "test", scriptTimeoutMs);
    steps.push({
      name: "tests",
      ok: tests.exitCode === 0,
      exitCode: tests.exitCode,
      command: tests.command,
      durationMs: tests.durationMs,
      timedOut: tests.timedOut,
    });
    if (tests.timedOut) {
      diagnostics.push(timedOutDiagnostic("test", scriptTimeoutMs));
    }
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

  if (profile === "smoke") {
    steps.push(skippedStep("eslint", "--smoke/--fast"));
  } else if (options.skipEslint) {
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
    profile,
    steps,
    diagnostics,
    durationMs: Date.now() - started,
    exitCode: ok ? 0 : 1,
  };
}
