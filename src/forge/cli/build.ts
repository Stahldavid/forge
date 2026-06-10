import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "./commands.ts";
import { runVerifyCommand } from "./verify.ts";
import { resolveBunExecutable } from "./bun-exec.ts";

export interface BuildCommandOptions {
  workspaceRoot: string;
  json: boolean;
}

export interface BuildCommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  steps: Array<{ name: string; ok: boolean; exitCode?: number }>;
  manifestPath?: string;
}

async function runOptionalScript(
  workspaceRoot: string,
  scriptName: string,
): Promise<{ skipped: boolean; exitCode: number }> {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { skipped: true, exitCode: 0 };
  }
  const pkg = await Bun.file(packageJsonPath).json() as { scripts?: Record<string, string> };
  if (!pkg.scripts?.[scriptName]) {
    return { skipped: true, exitCode: 0 };
  }
  const child = Bun.spawn([resolveBunExecutable(), "run", scriptName], {
    cwd: workspaceRoot,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  return { skipped: false, exitCode: await child.exited };
}

export async function runBuildCommand(options: BuildCommandOptions): Promise<BuildCommandResult> {
  const steps: BuildCommandResult["steps"] = [];
  const generate = await runGenerateCommand({
    workspaceRoot: options.workspaceRoot,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  steps.push({ name: "generate", ok: generate.exitCode === 0, exitCode: generate.exitCode });
  if (generate.exitCode !== 0) {
    return { ok: false, exitCode: 1, steps };
  }

  const verify = await runVerifyCommand({
    workspaceRoot: options.workspaceRoot,
    json: false,
    skipTests: false,
    skipTypecheck: false,
    skipEslint: false,
    strict: true,
  });
  steps.push({ name: "verify", ok: verify.exitCode === 0, exitCode: verify.exitCode });
  if (verify.exitCode !== 0) {
    return { ok: false, exitCode: 1, steps };
  }

  const webBuild = existsSync(join(options.workspaceRoot, "web", "package.json"))
    ? await runOptionalScript(join(options.workspaceRoot, "web"), "build")
    : { skipped: true, exitCode: 0 };
  steps.push({
    name: "web-build",
    ok: webBuild.exitCode === 0,
    exitCode: webBuild.skipped ? undefined : webBuild.exitCode,
  });
  if (webBuild.exitCode !== 0) {
    return { ok: false, exitCode: 1, steps };
  }

  const distDir = join(options.workspaceRoot, "dist", "forge");
  mkdirSync(distDir, { recursive: true });
  const manifestPath = join(distDir, "build-info.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify({
      schemaVersion: "0.1.0",
      builtAt: new Date(0).toISOString(),
      steps,
    }, null, 2)}\n`,
    "utf8",
  );

  return { ok: true, exitCode: 0, steps, manifestPath };
}

export function formatBuildHuman(result: BuildCommandResult): string {
  if (!result.ok) {
    return `forge build failed at ${result.steps.find((step) => !step.ok)?.name ?? "unknown"}\n`;
  }
  return `forge build complete: ${result.manifestPath}\n`;
}
