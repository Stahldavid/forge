import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { Dependency } from "../types/package-graph.ts";
import { hashTsconfigForWorkspace } from "../app-graph/tsconfig-hash.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import { detectPackageManager } from "../package-manager/detect.ts";
import {
  getLockfileCandidates,
  getLockfileForPm,
} from "../package-manager/detect.ts";
import { GENERATED_DIR } from "../emitter/constants.ts";
import type { DiscoverContext } from "./types.ts";
import {
  type SourceFileIndex,
  walkWorkspaceSources,
} from "./workspace-index.ts";

const DEFAULT_SOURCE_ROOTS = ["src", "tests"];

function readTextHash(absolutePath: string): string {
  return hashStable((nodeFileSystem.readText(absolutePath) ?? ""));
}

function hashFileIfExists(absolutePath: string): string {
  if (!nodeFileSystem.exists(absolutePath)) {
    return "";
  }
  return readTextHash(absolutePath);
}

function resolveLockfilePath(workspaceRoot: string): string | null {
  const pm = detectPackageManager(workspaceRoot);
  const candidates = getLockfileCandidates(pm);
  for (const file of candidates) {
    const absolute = join(workspaceRoot, file);
    if (nodeFileSystem.exists(absolute)) {
      return absolute;
    }
  }

  const fallback = join(workspaceRoot, getLockfileForPm(pm));
  return nodeFileSystem.exists(fallback) ? fallback : null;
}

interface WorkspacePackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  forge?: {
    sourceRoots?: string[];
  };
}

function readPackageJson(workspaceRoot: string): WorkspacePackageJson {
  const raw = (nodeFileSystem.readText(join(workspaceRoot, "package.json")) ?? "");
  return JSON.parse(raw) as WorkspacePackageJson;
}

function resolveSourceRoots(
  workspaceRoot: string,
  override?: string[],
): string[] {
  if (override) {
    return override;
  }

  try {
    const configured = readPackageJson(workspaceRoot).forge?.sourceRoots;
    if (configured && configured.length > 0) {
      return configured;
    }
  } catch {
    // fall back to defaults
  }

  return DEFAULT_SOURCE_ROOTS;
}

function resolveDependency(
  workspaceRoot: string,
  name: string,
  specifier: string,
  packageManager: ReturnType<typeof detectPackageManager>,
): Dependency | null {
  const installPath = join(workspaceRoot, "node_modules", name);
  if (!nodeFileSystem.exists(installPath)) {
    return null;
  }

  let version = specifier.replace(/^[\^~>=<]*/, "").trim();
  const pkgJsonPath = join(installPath, "package.json");
  if (nodeFileSystem.exists(pkgJsonPath)) {
    try {
      const installed = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
        version?: string;
      };
      if (installed.version) {
        version = installed.version;
      }
    } catch {
      // keep specifier-derived version
    }
  }

  return {
    name,
    version,
    packageManager,
    installPath: installPath.replace(/\\/g, "/"),
  };
}

function collectDependencies(workspaceRoot: string): Dependency[] {
  const packageManager = detectPackageManager(workspaceRoot);
  const pkg = readPackageJson(workspaceRoot);
  const specs = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  const deps: Dependency[] = [];
  for (const [name, specifier] of Object.entries(specs)) {
    const dep = resolveDependency(
      workspaceRoot,
      name,
      specifier,
      packageManager,
    );
    if (dep) {
      deps.push(dep);
    }
  }

  deps.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return deps;
}

function computeSourceFingerprint(sources: import("../types/app-graph.ts").SourceFile[]): string {
  const payload = sources.map((source) => ({
    path: source.path,
    contentHash: source.contentHash,
  }));
  return hashStable(canonicalJson(payload));
}

function computeInputFingerprint(parts: {
  sourceFingerprint: string;
  packageJsonHash: string;
  lockfileHash: string;
  tsconfigHash: string;
  dependencyVersions: Array<{ name: string; version: string }>;
}): string {
  return hashStable(canonicalJson(parts));
}

export function getSourceRoots(workspaceRoot: string, override?: string[]): string[] {
  return resolveSourceRoots(workspaceRoot, override);
}

export interface DiscoverOptions {
  workspaceRoot: string;
  sourceRoots?: string[];
  priorSourceIndex?: SourceFileIndex;
  priorSourcesByPath?: Map<string, import("../types/app-graph.ts").SourceFile>;
}

export function discover(options: DiscoverOptions): DiscoverContext {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const packageManager = detectPackageManager(workspaceRoot);
  const walked = walkWorkspaceSources({
    workspaceRoot,
    roots: resolveSourceRoots(workspaceRoot, options.sourceRoots),
    priorIndex: options.priorSourceIndex,
    priorSourcesByPath: options.priorSourcesByPath,
  });

  const dependencies = collectDependencies(workspaceRoot);

  const packageJsonHash = hashFileIfExists(join(workspaceRoot, "package.json"));
  const lockfilePath = resolveLockfilePath(workspaceRoot);
  const lockfileHash = lockfilePath ? readTextHash(lockfilePath) : "";
  const tsconfigPath = nodeFileSystem.exists(join(workspaceRoot, "tsconfig.json"))
    ? "tsconfig.json"
    : null;
  const tsconfigHash = hashTsconfigForWorkspace(workspaceRoot, tsconfigPath ?? undefined);
  const sourceFingerprint = computeSourceFingerprint(walked.sources);

  const inputFingerprint = computeInputFingerprint({
    sourceFingerprint,
    packageJsonHash,
    lockfileHash,
    tsconfigHash,
    dependencyVersions: dependencies.map((dep) => ({
      name: dep.name,
      version: dep.version,
    })),
  });

  return {
    workspaceRoot,
    cacheDir: join(workspaceRoot, ".forge", "cache"),
    generatedDir: GENERATED_DIR,
    packageManager,
    sources: walked.sources,
    dependencies,
    tsconfigPath,
    packageJsonHash,
    lockfileHash,
    tsconfigHash,
    sourceFingerprint,
    inputFingerprint,
    sourceFileIndex: walked.index,
  };
}
