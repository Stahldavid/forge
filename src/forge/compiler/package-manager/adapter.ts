import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "../types/runtime.ts";
import type { PmAddOptions, PmAddResult } from "../types/cli.ts";
import { buildAddCommand } from "./commands.ts";
import {
  detectPackageManager,
  getLockfileCandidates,
  getLockfileForPm,
} from "./detect.ts";
import {
  defaultCommandExecutor,
  PackageManagerCommandError,
  type CommandExecutor,
} from "./executor.ts";
import { parsePackageName } from "./parse-spec.ts";
import { readInstalledVersion } from "./version.ts";

export interface PackageManagerAdapter {
  readonly name: PackageManager;
  readonly lockfile: string;
  add(spec: string, opts: PmAddOptions): Promise<PmAddResult>;
  dryRunAdd(spec: string, opts: PmAddOptions): Promise<PmAddResult>;
  /** Install into a temp dir; caller owns cleanup unless using dryRunAdd. */
  dryRunAddWithPath(spec: string, opts: PmAddOptions): Promise<DryRunAddResult>;
  detectResolvedVersion(spec: string, cwd: string): Promise<string>;
}

export interface DryRunAddResult extends PmAddResult {
  /** Absolute path to the temp install directory (for downstream analysis). */
  installPath: string;
}

export interface CreatePackageManagerAdapterOptions {
  executor?: CommandExecutor;
  /** When true, retain the temp directory after dryRunAdd (for debugging). */
  retainDryRunDir?: boolean;
}

function hashFile(path: string): string | null {
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  const content = readFileSync(path);
  return createHash("sha256").update(content).digest("hex");
}

function hashLockfiles(cwd: string, pm: PackageManager): string | null {
  const hashes: string[] = [];
  for (const file of getLockfileCandidates(pm)) {
    const h = hashFile(join(cwd, file));
    if (h !== null) {
      hashes.push(`${file}:${h}`);
    }
  }
  return hashes.length > 0 ? hashes.join("|") : null;
}

function lockfileChanged(
  before: string | null,
  after: string | null,
  pm: PackageManager,
  cwd: string,
): boolean {
  if (before !== after) {
    return true;
  }
  // Lockfile may be created on first install.
  if (before === null) {
    return getLockfileCandidates(pm).some((f) =>
      nodeFileSystem.exists(join(cwd, f)),
    );
  }
  return false;
}

async function runInstall(
  pm: PackageManager,
  spec: string,
  opts: PmAddOptions,
  executor: CommandExecutor,
): Promise<PmAddResult> {
  const ignoreScripts = opts.ignoreScripts ?? true;
  const argv = buildAddCommand(pm, spec, { ignoreScripts });
  const lockBefore = hashLockfiles(opts.cwd, pm);

  const result = await executor.run(argv, { cwd: opts.cwd });
  if (result.exitCode !== 0) {
    throw new PackageManagerCommandError(
      `Package manager ${pm} failed to add ${spec}: ${result.stderr || result.stdout}`,
      argv,
      result,
    );
  }

  const packageName = parsePackageName(spec);
  const resolvedVersion = readInstalledVersion(packageName, opts.cwd);
  if (!resolvedVersion) {
    throw new Error(
      `Could not detect installed version for ${packageName} in ${opts.cwd}`,
    );
  }

  const lockAfter = hashLockfiles(opts.cwd, pm);

  return {
    resolvedVersion,
    lockfileChanged: lockfileChanged(lockBefore, lockAfter, pm, opts.cwd),
  };
}

class PackageManagerAdapterImpl implements PackageManagerAdapter {
  readonly name: PackageManager;
  readonly lockfile: string;
  private readonly executor: CommandExecutor;
  private readonly retainDryRunDir: boolean;

  constructor(
    name: PackageManager,
    options: CreatePackageManagerAdapterOptions = {},
  ) {
    this.name = name;
    this.lockfile = getLockfileForPm(name);
    this.executor = options.executor ?? defaultCommandExecutor;
    this.retainDryRunDir = options.retainDryRunDir ?? false;
  }

  async add(spec: string, opts: PmAddOptions): Promise<PmAddResult> {
    return runInstall(this.name, spec, opts, this.executor);
  }

  async dryRunAdd(spec: string, opts: PmAddOptions): Promise<PmAddResult> {
    const result = await this.dryRunAddWithPath(spec, opts);
    if (!this.retainDryRunDir) {
      try {
        nodeFileSystem.remove(result.installPath);
      } catch {
        // best-effort cleanup
      }
    }
    return {
      resolvedVersion: result.resolvedVersion,
      integrity: result.integrity,
      lockfileChanged: false,
    };
  }

  /** Internal: dry-run install returning the temp directory path. */
  async dryRunAddWithPath(
    spec: string,
    opts: PmAddOptions,
  ): Promise<DryRunAddResult> {
    const cacheBase = join(opts.cwd, ".forge", "cache", "dry-run");
    nodeFileSystem.mkdirp(cacheBase);
    const tempDir = nodeFileSystem.makeTempDir(join(cacheBase, "add-"));

    const minimalPkg = {
      name: "forge-dry-run",
      private: true,
      version: "0.0.0",
    };
    writeFileSync(
      join(tempDir, "package.json"),
      `${JSON.stringify(minimalPkg, null, 2)}\n`,
      "utf8",
    );

    const installResult = await runInstall(
      this.name,
      spec,
      {
        cwd: tempDir,
        ignoreScripts: opts.ignoreScripts ?? true,
      },
      this.executor,
    );

    return {
      ...installResult,
      lockfileChanged: false,
      installPath: tempDir,
    };
  }

  async detectResolvedVersion(spec: string, cwd: string): Promise<string> {
    const version = readInstalledVersion(spec, cwd);
    if (!version) {
      throw new Error(
        `Package ${parsePackageName(spec)} is not installed in ${cwd}`,
      );
    }
    return version;
  }
}

export function createPackageManagerAdapter(
  pm: PackageManager,
  options?: CreatePackageManagerAdapterOptions,
): PackageManagerAdapter {
  return new PackageManagerAdapterImpl(pm, options);
}

export function detectAndCreatePackageManagerAdapter(
  workspaceRoot: string,
  options?: CreatePackageManagerAdapterOptions,
): PackageManagerAdapter {
  const pm = detectPackageManager(workspaceRoot);
  return createPackageManagerAdapter(pm, options);
}

/** Fallback when dry-run install is unavailable: recipe-known plan placeholder. */
export function dryRunRecipeFallbackMessage(alias: string): string {
  return (
    `Dry-run for "${alias}": .d.ts analysis requires a real install. ` +
    `Use dryRunAdd to install into a temp directory, or run forge add without --dry-run.`
  );
}

export {
  detectPackageManager,
  detectPackageManagerFromLockfiles,
  getLockfileForPm,
  getLockfileCandidates,
  parsePackageManagerField,
  LOCKFILE_PM_MAP,
} from "./detect.ts";
export { buildAddCommand } from "./commands.ts";
export { parsePackageName } from "./parse-spec.ts";
export { readInstalledVersion } from "./version.ts";
export {
  defaultCommandExecutor,
  PackageManagerCommandError,
  type CommandExecutor,
  type CommandRunResult,
} from "./executor.ts";
