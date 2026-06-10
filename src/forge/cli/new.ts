import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";

export type NewTemplateName = "b2b-support-web";
export type NewPackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface NewCommandOptions {
  name: string;
  template: NewTemplateName;
  packageManager: NewPackageManager;
  install: boolean;
  git: boolean;
  workspaceRoot: string;
}

export interface NewCommandResult {
  name: string;
  template: NewTemplateName;
  targetDir: string;
  packageManager: NewPackageManager;
  installed: boolean;
  gitInitialized: boolean;
  generated: boolean;
  exitCode: 0 | 1;
  message: string;
  nextSteps: string[];
}

const TEXT_EXTENSIONS = new Set([
  "",
  ".css",
  ".env",
  ".example",
  ".json",
  ".md",
  ".ts",
  ".tsx",
]);

function repoRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..");
}

function templateRoot(template: NewTemplateName): string {
  return join(repoRoot(), "templates", template);
}

function extensionFor(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const index = name.indexOf(".");
  return index === -1 ? "" : name.slice(index);
}

function isTextFile(path: string): boolean {
  return TEXT_EXTENSIONS.has(extensionFor(path));
}

function displayName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function replaceTokens(targetDir: string, appName: string, packageManager: string): void {
  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!stat.isFile() || !isTextFile(absolute)) {
        continue;
      }

      const text = readFileSync(absolute, "utf8")
        .replaceAll("__FORGE_APP_NAME__", appName)
        .replaceAll("__FORGE_APP_TITLE__", displayName(appName))
        .replaceAll("__PACKAGE_MANAGER__", packageManager);
      writeFileSync(absolute, text, "utf8");
    }
  }

  walk(targetDir);
}

function ensureProjectName(name: string): string | null {
  if (!name.trim()) {
    return "forge new requires a project name";
  }
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    return "project name must be a directory name, not a path";
  }
  return null;
}

async function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "ignore",
  });
  return child.exited;
}

export async function runNewCommand(options: NewCommandOptions): Promise<NewCommandResult> {
  const projectNameError = ensureProjectName(options.name);
  if (projectNameError) {
    return {
      name: options.name,
      template: options.template,
      targetDir: "",
      packageManager: options.packageManager,
      installed: false,
      gitInitialized: false,
      generated: false,
      exitCode: 1,
      message: projectNameError,
      nextSteps: [],
    };
  }

  const source = templateRoot(options.template);
  if (!existsSync(source)) {
    return {
      name: options.name,
      template: options.template,
      targetDir: "",
      packageManager: options.packageManager,
      installed: false,
      gitInitialized: false,
      generated: false,
      exitCode: 1,
      message: `unknown template '${options.template}'`,
      nextSteps: [],
    };
  }

  const targetDir = resolve(options.workspaceRoot, options.name);
  if (existsSync(targetDir)) {
    return {
      name: options.name,
      template: options.template,
      targetDir,
      packageManager: options.packageManager,
      installed: false,
      gitInitialized: false,
      generated: false,
      exitCode: 1,
      message: `target directory already exists: ${relative(options.workspaceRoot, targetDir)}`,
      nextSteps: [],
    };
  }

  mkdirSync(targetDir, { recursive: true });
  cpSync(source, targetDir, { recursive: true, force: true });
  replaceTokens(targetDir, options.name, options.packageManager);

  let installed = false;
  if (options.install) {
    const installCode = await spawnCommand(options.packageManager, ["install"], targetDir);
    installed = installCode === 0;
    if (!installed) {
      return {
        name: options.name,
        template: options.template,
        targetDir,
        packageManager: options.packageManager,
        installed,
        gitInitialized: false,
        generated: false,
        exitCode: 1,
        message: `${options.packageManager} install failed`,
        nextSteps: [],
      };
    }
  }

  let generated = false;
  if (existsSync(join(targetDir, "node_modules"))) {
    const generate = await runGenerate({
      workspaceRoot: targetDir,
      check: false,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    generated = generate.exitCode === 0;
    if (!generated) {
      return {
        name: options.name,
        template: options.template,
        targetDir,
        packageManager: options.packageManager,
        installed,
        gitInitialized: false,
        generated,
        exitCode: 1,
        message: `forge generate failed: ${generate.errors.map((error) => error.message).join("; ")}`,
        nextSteps: [],
      };
    }
  }

  let gitInitialized = false;
  if (options.git) {
    const gitCode = await spawnCommand("git", ["init"], targetDir);
    gitInitialized = gitCode === 0;
  }

  const nextSteps = [
    `cd ${options.name}`,
    `${options.packageManager} install`,
    `${options.packageManager} run generate`,
    `${options.packageManager} run verify`,
    `${options.packageManager} run dev:api`,
    `${options.packageManager} run dev:web`,
  ];

  return {
    name: options.name,
    template: options.template,
    targetDir,
    packageManager: options.packageManager,
    installed,
    gitInitialized,
    generated,
    exitCode: 0,
    message: `Created ${options.name} from template ${options.template}.`,
    nextSteps,
  };
}

export function formatNewHuman(result: NewCommandResult): string {
  if (result.exitCode !== 0) {
    return `error: ${result.message}\n`;
  }

  return [
    result.message,
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `  ${step}`),
    "",
  ].join("\n");
}
