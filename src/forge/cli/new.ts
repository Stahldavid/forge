import { spawn } from "node:child_process";
import { cpSync, statSync } from "node:fs";
import { dirname, join, parse, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { resolvePackageManagerArgv } from "../compiler/package-manager/executor.ts";
import { moduleDir } from "../platform/module.ts";

export type NewTemplateName = "agent-workroom" | "b2b-support-web" | "minimal-web" | "nuxt-web";
export type NewPackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface NewCommandOptions {
  name: string;
  template: NewTemplateName;
  packageManager: NewPackageManager;
  install: boolean;
  git: boolean;
  forgePackageSpec?: string;
  localForge?: boolean;
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
  gitHygiene: {
    ok: boolean;
    ignoredPaths: string[];
    missingPaths: string[];
  };
  exitCode: 0 | 1;
  message: string;
  nextSteps: string[];
}

const REQUIRED_GITIGNORE_PATHS = [
  "src/forge/_generated/",
  "forge.lock",
  ".forge/cache/",
  ".forge/pglite/",
  ".forge/delta/",
  ".forge/agent/*.ndjson",
  ".forge/agent/*.history",
  ".forge/local/",
  ".forge/test-cache/",
  ".forge/test-runs/",
  ".forge/ui-runs/",
  ".forge/repairs/",
  ".forge/refactors/",
  ".forge/upgrades/",
  ".forge/reviews/",
  ".forge/impact/",
  ".forge/agent-adapters/",
  ".forge/studio/",
] as const;

const DEFAULT_FORGE_PACKAGE_SPEC = "npm:forgeos@alpha";

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

function packageRoot(): string {
  let current = moduleDir(import.meta);
  const root = parse(current).root;
  while (true) {
    if (
      nodeFileSystem.exists(join(current, "package.json")) &&
      nodeFileSystem.exists(join(current, "templates"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current || current === root) {
      return resolve(moduleDir(import.meta), "..", "..", "..");
    }
    current = parent;
  }
}

function templateRoot(template: NewTemplateName): string {
  return join(packageRoot(), "templates", template);
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

function localForgePackageSpec(targetDir: string): string {
  const root = packageRoot();
  const relativeRoot = relative(targetDir, root).replace(/\\/g, "/");
  if (!relativeRoot || relativeRoot.includes(":")) {
    return pathToFileURL(root).href;
  }
  return `file:${relativeRoot.startsWith(".") ? relativeRoot : `./${relativeRoot}`}`;
}

function normalizeForgePackageSpec(spec: string): string {
  if (!spec.toLowerCase().startsWith("file:") || !spec.includes("\\")) {
    return spec;
  }
  const fileTarget = spec.slice("file:".length);
  if (/^[a-z]:[\\/]/i.test(fileTarget)) {
    return `file:///${fileTarget.replace(/\\/g, "/")}`;
  }
  if (fileTarget.startsWith("\\\\")) {
    return pathToFileURL(resolve(fileTarget)).href;
  }
  return `file:${fileTarget.replace(/\\/g, "/")}`;
}

function forgePackageSpec(targetDir: string, options: Pick<NewCommandOptions, "forgePackageSpec" | "localForge">): string {
  if (options.forgePackageSpec && !options.localForge) {
    return normalizeForgePackageSpec(options.forgePackageSpec);
  }
  if (options.localForge) {
    return localForgePackageSpec(targetDir);
  }
  return DEFAULT_FORGE_PACKAGE_SPEC;
}

function packageManagerSpec(packageManager: string): string {
  switch (packageManager) {
    case "bun":
      return "bun@1.3.14";
    case "npm":
      return "npm@10.9.0";
    case "pnpm":
      return "pnpm@9.15.4";
    case "yarn":
      return "yarn@4.6.0";
    default:
      return packageManager;
  }
}

function replaceTokens(targetDir: string, appName: string, packageManager: string, packageSpec: string): void {
  const packageManagerWithVersion = packageManagerSpec(packageManager);
  function walk(dir: string): void {
    for (const entry of nodeFileSystem.readDir(dir)) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === "_generated" || entry.name === "node_modules" || entry.name === ".git") {
          continue;
        }
        walk(absolute);
        continue;
      }
      if (!entry.isFile || !isTextFile(absolute)) {
        continue;
      }

      const text = (nodeFileSystem.readText(absolute) ?? "")
        .replaceAll("__FORGE_APP_NAME__", appName)
        .replaceAll("__FORGE_APP_TITLE__", displayName(appName))
        .replaceAll("__PACKAGE_MANAGER__", packageManager)
        .replaceAll("__PACKAGE_MANAGER_SPEC__", packageManagerWithVersion)
        .replaceAll("__FORGE_PACKAGE_SPEC__", packageSpec);
      nodeFileSystem.writeText(absolute, text);
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

function analyzeGitHygiene(targetDir: string): NewCommandResult["gitHygiene"] {
  const gitignorePath = join(targetDir, ".gitignore");
  const gitignore = nodeFileSystem.exists(gitignorePath)
    ? (nodeFileSystem.readText(gitignorePath) ?? "")
    : "";
  const missingPaths = REQUIRED_GITIGNORE_PATHS.filter(
    (path) => !gitignore.includes(path),
  );
  return {
    ok: missingPaths.length === 0,
    ignoredPaths: [...REQUIRED_GITIGNORE_PATHS],
    missingPaths,
  };
}

function ensureGitignore(targetDir: string): void {
  const gitignorePath = join(targetDir, ".gitignore");
  const existing = nodeFileSystem.exists(gitignorePath)
    ? (nodeFileSystem.readText(gitignorePath) ?? "")
    : "";
  const normalized = existing.replace(/\r\n/g, "\n");
  const missingPaths = REQUIRED_GITIGNORE_PATHS.filter(
    (path) => !normalized.includes(path),
  );
  if (normalized.trim().length > 0 && missingPaths.length === 0) {
    return;
  }

  const sections = [
    normalized.trimEnd(),
    normalized.trim().length > 0 ? "" : "node_modules/\ndist/\n.env\n.env.local",
    "# ForgeOS generated and local runtime artifacts",
    ...missingPaths,
  ].filter(Boolean);
  nodeFileSystem.writeText(gitignorePath, `${sections.join("\n")}\n`);
}

async function spawnCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<number> {
  let argv = resolvePackageManagerArgv([command, ...args]);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(argv[0] ?? "")) {
    argv = [process.env.ComSpec ?? "cmd.exe", "/d", "/c", command, ...args];
  }
  return new Promise<number>((resolveExitCode) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0]!, argv.slice(1), {
        cwd,
        stdio: ["ignore", "inherit", "inherit"],
        windowsHide: true,
      });
    } catch {
      resolveExitCode(1);
      return;
    }
    child.on("error", () => resolveExitCode(1));
    child.on("close", (code) => resolveExitCode(code ?? 1));
  });
}


function lockfileNamesFor(packageManager: NewPackageManager): string[] {
  switch (packageManager) {
    case "bun":
      return ["bun.lock", "bun.lockb"];
    case "npm":
      return ["package-lock.json"];
    case "pnpm":
      return ["pnpm-lock.yaml"];
    case "yarn":
      return ["yarn.lock"];
  }
}

function readPackageDependencyNames(packageJsonPath: string): string[] {
  try {
    const parsed = JSON.parse(nodeFileSystem.readText(packageJsonPath) ?? "{}") as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return Object.keys({
      ...(parsed.dependencies ?? {}),
      ...(parsed.devDependencies ?? {}),
    }).sort();
  } catch {
    return [];
  }
}

function workspacePackageDirs(targetDir: string): string[] {
  try {
    const parsed = JSON.parse(nodeFileSystem.readText(join(targetDir, "package.json")) ?? "{}") as {
      workspaces?: string[] | { packages?: string[] };
    };
    const workspaces = Array.isArray(parsed.workspaces)
      ? parsed.workspaces
      : Array.isArray(parsed.workspaces?.packages)
        ? parsed.workspaces.packages
        : [];
    return workspaces
      .filter((workspace) => !workspace.includes("*"))
      .map((workspace) => join(targetDir, workspace))
      .filter((workspaceDir) => nodeFileSystem.exists(join(workspaceDir, "package.json")));
  } catch {
    return [];
  }
}

function dependencyInstallChecks(targetDir: string): Array<{ name: string; candidates: string[] }> {
  const packageDirs = [targetDir, ...workspacePackageDirs(targetDir)];
  const checks = new Map<string, string[]>();
  for (const packageDir of packageDirs) {
    for (const name of readPackageDependencyNames(join(packageDir, "package.json"))) {
      const candidates = checks.get(name) ?? [];
      candidates.push(join(targetDir, "node_modules", name));
      candidates.push(join(packageDir, "node_modules", name));
      checks.set(name, candidates);
    }
  }
  return [...checks.entries()]
    .map(([name, candidates]) => ({
      name,
      candidates: [...new Set(candidates)].sort(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function waitForInstallArtifacts(
  targetDir: string,
  packageManager: NewPackageManager,
): Promise<void> {
  const lockfiles = lockfileNamesFor(packageManager).map((name) => join(targetDir, name));
  const dependencyChecks = dependencyInstallChecks(targetDir);
  let previousSignature = "";
  let stableReads = 0;

  for (let attempt = 0; attempt < 80; attempt++) {
    const dependencySignature = dependencyChecks.map((check) => `${check.name}:${
      check.candidates.some((candidate) => nodeFileSystem.exists(candidate)) ? "1" : "0"
    }`);
    const signature = [
      nodeFileSystem.exists(join(targetDir, "node_modules")) ? "node_modules:1" : "node_modules:0",
      ...dependencySignature,
      ...lockfiles.map((path) => {
        if (!nodeFileSystem.exists(path)) {
          return `${path}:missing`;
        }
        return `${path}:${statSync(path).size}`;
      }),
    ].join("|");

    const dependenciesReady = dependencySignature.every((entry) => entry.endsWith(":1"));
    if (signature === previousSignature && signature.includes("node_modules:1") && dependenciesReady) {
      stableReads += 1;
      if (stableReads >= 2) {
        return;
      }
    } else {
      stableReads = 0;
      previousSignature = signature;
    }

    await sleep(100);
  }
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
      gitHygiene: { ok: false, ignoredPaths: [], missingPaths: [] },
      exitCode: 1,
      message: projectNameError,
      nextSteps: [],
    };
  }

  const source = templateRoot(options.template);
  if (!nodeFileSystem.exists(source)) {
    return {
      name: options.name,
      template: options.template,
      targetDir: "",
      packageManager: options.packageManager,
      installed: false,
      gitInitialized: false,
      generated: false,
      gitHygiene: { ok: false, ignoredPaths: [], missingPaths: [] },
      exitCode: 1,
      message: `unknown template '${options.template}'`,
      nextSteps: [],
    };
  }

  const targetDir = resolve(options.workspaceRoot, options.name);
  if (nodeFileSystem.exists(targetDir)) {
    return {
      name: options.name,
      template: options.template,
      targetDir,
      packageManager: options.packageManager,
      installed: false,
      gitInitialized: false,
      generated: false,
      gitHygiene: { ok: false, ignoredPaths: [], missingPaths: [] },
      exitCode: 1,
      message: `target directory already exists: ${relative(options.workspaceRoot, targetDir)}`,
      nextSteps: [],
    };
  }

  nodeFileSystem.mkdirp(targetDir);
  cpSync(source, targetDir, { recursive: true, force: true });
  ensureGitignore(targetDir);
  replaceTokens(
    targetDir,
    options.name,
    options.packageManager,
    forgePackageSpec(targetDir, options),
  );

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
        gitHygiene: analyzeGitHygiene(targetDir),
        exitCode: 1,
        message: `${options.packageManager} install failed`,
        nextSteps: [],
      };
    }
    await waitForInstallArtifacts(targetDir, options.packageManager);
  }

  let generated = false;
  if (nodeFileSystem.exists(join(targetDir, "node_modules"))) {
    if (installed) {
      await waitForInstallArtifacts(targetDir, options.packageManager);
      const generateCode = await spawnCommand(options.packageManager, ["run", "generate"], targetDir);
      generated = generateCode === 0;
    } else {
      const generate = await runGenerate({
        workspaceRoot: targetDir,
        check: false,
        dryRun: false,
        json: false,
        concurrency: 4,
      });
      generated = generate.exitCode === 0;
    }
    if (!generated) {
      return {
        name: options.name,
        template: options.template,
        targetDir,
        packageManager: options.packageManager,
        installed,
        gitInitialized: false,
        generated,
        gitHygiene: analyzeGitHygiene(targetDir),
        exitCode: 1,
        message: "forge generate failed",
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
    ...(installed ? [] : [`${options.packageManager} install`]),
    ...(generated ? [] : [`${options.packageManager} run generate`]),
    `${options.packageManager} run dev -- --open`,
    `${options.packageManager} run verify`,
  ];
  const gitHygiene = analyzeGitHygiene(targetDir);

  return {
    name: options.name,
    template: options.template,
    targetDir,
    packageManager: options.packageManager,
    installed,
    gitInitialized,
    generated,
    gitHygiene,
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
    ...(result.gitHygiene.ok
      ? ["Generated and operational Forge files are ignored by git."]
      : [
          `warning: template is missing gitignore entries: ${result.gitHygiene.missingPaths.join(", ")}`,
        ]),
    "",
    "Next steps:",
    ...result.nextSteps.map((step) => `  ${step}`),
    "",
  ].join("\n");
}

export function formatNewJson(result: NewCommandResult): string {
  return `${JSON.stringify({
    schemaVersion: "0.1.0",
    ok: result.exitCode === 0,
    ...result,
  }, null, 2)}\n`;
}
