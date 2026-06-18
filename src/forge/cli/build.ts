import { spawn } from "node:child_process";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { runGenerateCommand } from "./commands.ts";
import { runVerifyCommand } from "./verify.ts";
import { detectPackageManager } from "../compiler/package-manager/detect.ts";
import { resolvePackageManagerArgv } from "../compiler/package-manager/executor.ts";

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
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return { skipped: true, exitCode: 0 };
  }
  const pkg = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts?.[scriptName]) {
    return { skipped: true, exitCode: 0 };
  }
  const packageManager = detectPackageManager(workspaceRoot);
  const argv = resolvePackageManagerArgv([packageManager, "run", scriptName]);
  const exitCode = await new Promise<number>((resolveExitCode, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: workspaceRoot,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("close", (code) => resolveExitCode(code ?? 1));
  });
  return { skipped: false, exitCode };
}

function readPackageScripts(workspaceRoot: string): Record<string, string> {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return {};
  }
  const pkg = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts ?? {};
}

function shouldTypecheckBuild(workspaceRoot: string): boolean {
  const scripts = readPackageScripts(workspaceRoot);
  return Boolean(scripts.typecheck || nodeFileSystem.exists(join(workspaceRoot, "tsconfig.json")));
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
    skipTests: true,
    skipTypecheck: !shouldTypecheckBuild(options.workspaceRoot),
    skipEslint: true,
    strict: false,
  });
  steps.push({ name: "verify", ok: verify.exitCode === 0, exitCode: verify.exitCode });
  if (verify.exitCode !== 0) {
    return { ok: false, exitCode: 1, steps };
  }

  const webBuild = nodeFileSystem.exists(join(options.workspaceRoot, "web", "package.json"))
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
  nodeFileSystem.mkdirp(distDir);
  const manifestPath = join(distDir, "build-info.json");
  nodeFileSystem.writeText(manifestPath, `${JSON.stringify({
    schemaVersion: "0.1.0",
    builtAt: new Date(0).toISOString(),
    steps,
  }, null, 2)}\n`);

  return { ok: true, exitCode: 0, steps, manifestPath };
}

export function formatBuildHuman(result: BuildCommandResult): string {
  if (!result.ok) {
    return `forge build failed at ${result.steps.find((step) => !step.ok)?.name ?? "unknown"}\n`;
  }
  return `forge build complete: ${result.manifestPath}\n`;
}
