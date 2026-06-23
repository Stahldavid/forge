import { nodeFileSystem } from "../compiler/fs/index.ts";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { register, type NamespacedUnregister } from "tsx/esm/api";
import ts from "typescript";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { buildRuntimeMatrix } from "../compiler/classifier/runtime-matrix.ts";
import { classify } from "../compiler/classifier/classify.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_RUNTIME_NOT_FOUND,
} from "../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import { GENERATED_DIR, FORGE_LOCK_PATH } from "../compiler/emitter/constants.ts";
import { checkImportGuards } from "../compiler/guards/check-import-guards.ts";
import { discover } from "../compiler/orchestrator/discover.ts";
import { loadManifest } from "../compiler/orchestrator/manifest.ts";
import { PackageGraphCompiler } from "../compiler/package-graph/compiler.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { resolveByPackageName } from "../compiler/recipes/registry.ts";
import type { ModuleGraph } from "../compiler/types/app-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { ForgeLock } from "../compiler/types/lock.ts";
import type { RuntimeEntry, RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import type { RuntimeMatrix } from "../compiler/types/runtime-matrix.ts";
import type { DbAdapter } from "./db/adapter.ts";
import type { AuthContext } from "./auth/types.ts";
import type { LiveSubscriptionManager } from "./live/types.ts";
import { resolveAuthFromCli } from "./auth/resolve.ts";
import {
  executeResolvedEntry,
  guardBlockedDiagnostics,
  resolveHandlerFromModule,
  type RunEntryRuntime,
} from "./runner/run-entry.ts";

export interface RunEntryOptions {
  json: boolean;
  mock: boolean;
  args?: unknown;
  db?: DbAdapter | null;
  auth?: AuthContext;
  userId?: string;
  tenantId?: string;
  role?: string;
  liveManager?: LiveSubscriptionManager;
}

export interface RunEntryResult {
  ok: boolean;
  result?: unknown;
  entry?: RuntimeEntry;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
  traceId?: string;
}

export interface ListEntriesResult {
  entries: RuntimeEntry[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface PrepareRuntimeEnvironmentOptions {
  mock: boolean;
  mockAi?: boolean;
  db?: DbAdapter | null;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function loadRuntimeGraph(workspaceRoot: string): {
  graph: RuntimeGraph | null;
  diagnostics: Diagnostic[];
} {
  const graph = readGeneratedJson<RuntimeGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeGraph.json`,
  );

  if (!graph) {
    return {
      graph: null,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/runtimeGraph.json; run forge generate first`,
          file: `${GENERATED_DIR}/runtimeGraph.json`,
        }),
      ],
    };
  }

  return { graph, diagnostics: [...(graph.diagnostics ?? [])] };
}

function loadTableMap(workspaceRoot: string): Record<string, TableMapEntry> | null {
  const dbJson = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
    workspaceRoot,
    `${GENERATED_DIR}/db.json`,
  );
  return dbJson?.tableMap ?? null;
}

function moduleClosure(moduleGraph: ModuleGraph, rootModuleId: string): Set<string> {
  const closure = new Set<string>();
  const nodesById = new Map(moduleGraph.nodes.map((node) => [node.id, node]));
  const queue = [rootModuleId];

  while (queue.length > 0) {
    const moduleId = queue.pop()!;
    if (closure.has(moduleId)) {
      continue;
    }
    closure.add(moduleId);

    const node = nodesById.get(moduleId);
    if (!node) {
      continue;
    }

    for (const imp of node.localImports) {
      queue.push(imp.toModuleId);
    }
  }

  return closure;
}

function filesForModuleClosure(
  moduleGraph: ModuleGraph,
  closure: Set<string>,
): Set<string> {
  const files = new Set<string>();
  for (const node of moduleGraph.nodes) {
    if (closure.has(node.id)) {
      files.add(node.file);
    }
  }
  return files;
}

async function loadRuntimeMatrix(workspaceRoot: string): Promise<RuntimeMatrix> {
  const fromDisk = readGeneratedJson<RuntimeMatrix>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeMatrix.json`,
  );
  if (fromDisk) {
    return fromDisk;
  }

  const ctx = discover({ workspaceRoot });
  const compiler = new PackageGraphCompiler();
  const classified = await Promise.all(
    ctx.dependencies.map(async (dep) => {
      const recipe = resolveByPackageName(dep.name) ?? undefined;
      const api = await compiler.analyze(dep, {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        recipeVersion: recipe?.recipeVersion,
      });
      return {
        api,
        classification: classify(api, recipe),
        recipe,
      };
    }),
  );

  return buildRuntimeMatrix(classified);
}

function loadForgeLock(workspaceRoot: string): ForgeLock | null {
  const absolute = join(workspaceRoot, FORGE_LOCK_PATH);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as ForgeLock;
}

function loadMockMap(workspaceRoot: string): Record<string, string> {
  const fromJson = readGeneratedJson<{ entries: { packageName: string; mockFile: string }[] }>(
    workspaceRoot,
    `${GENERATED_DIR}/mockMap.json`,
  );
  if (fromJson?.entries) {
    const map: Record<string, string> = {};
    for (const entry of fromJson.entries) {
      map[entry.packageName] = entry.mockFile;
    }
    return map;
  }

  return {};
}

function capitalizeSegment(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function applyMocks(workspaceRoot: string, lock: ForgeLock | null): Promise<void> {
  const mockMap = loadMockMap(workspaceRoot);

  for (const [packageName, relativePath] of Object.entries(mockMap).sort()) {
    const absolute = join(workspaceRoot, relativePath);
    if (!nodeFileSystem.exists(absolute)) {
      continue;
    }

    const mod = (await import(pathToFileURL(absolute).href)) as Record<string, unknown>;
    const factoryName = `create${capitalizeSegment(packageName)}Mock`;
    const factory = mod[factoryName];

    const bunMock = Bun as typeof Bun & {
      mock: { module: (specifier: string, factory: () => unknown) => void };
    };

    bunMock.mock.module(packageName, () => {
      if (typeof factory === "function") {
        const mockValue = (factory as () => unknown)();
        if (typeof mockValue === "function") {
          return { default: mockValue };
        }
        const MockConstructor = function MockConstructor() {
          return mockValue;
        };
        return { default: MockConstructor, ...(mockValue as object) };
      }
      return mod;
    });
  }

  if (lock) {
    for (const pkg of lock.packages) {
      for (const secret of pkg.secrets) {
        if (!process.env[secret.envVar]) {
          process.env[secret.envVar] = `sk_forge_mock_${secret.envVar.toLowerCase()}`;
        }
      }
    }
  }
}

let activeDbAdapter: DbAdapter | null = null;
let activeRuntimeImporter: NamespacedUnregister | null = null;
let runtimeImportSequence = 0;
let runtimeEntryImportNonce = 0;
let runtimeEntryCacheEnabled = false;
const runtimeCacheInstance = `${process.pid}-${Date.now()}`;

export function refreshRuntimeModuleNamespace(reason = "runtime"): void {
  const previous = activeRuntimeImporter;
  runtimeEntryCacheEnabled = true;
  runtimeImportSequence += 1;
  activeRuntimeImporter = register({
    namespace: `forge-runtime-${Date.now()}-${runtimeImportSequence}-${reason}`,
  });
  void previous?.unregister().catch(() => undefined);
}

export function disposeRuntimeModuleNamespace(): void {
  const previous = activeRuntimeImporter;
  activeRuntimeImporter = null;
  runtimeEntryCacheEnabled = false;
  void previous?.unregister().catch(() => undefined);
}

async function importRuntimeModule(specifier: string): Promise<Record<string, unknown>> {
  if (activeRuntimeImporter) {
    return (await activeRuntimeImporter.import(specifier, import.meta.url)) as Record<string, unknown>;
  }
  return (await import(specifier)) as Record<string, unknown>;
}

function resolveRelativeRuntimeImport(fromFile: string, specifier: string): string {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    join(base, "index.js"),
    join(base, "index.jsx"),
  ];
  return candidates.find((candidate) => nodeFileSystem.exists(candidate)) ?? base;
}

function versionedRuntimeFileUrl(absolutePath: string): string {
  const url = pathToFileURL(absolutePath);
  if (runtimeImportSequence > 0) {
    url.searchParams.set("forgeRuntime", String(runtimeImportSequence));
  }
  return url.href;
}

function rewriteRelativeRuntimeImports(source: string, fromFile: string): string {
  const toVersionedUrl = (specifier: string) =>
    versionedRuntimeFileUrl(resolveRelativeRuntimeImport(fromFile, specifier));
  return source
    .replace(/(\bfrom\s*["'])(\.[^"']+)(["'])/g, (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${toVersionedUrl(specifier)}${suffix}`,
    )
    .replace(/(\bimport\s*["'])(\.[^"']+)(["'];?)/g, (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${toVersionedUrl(specifier)}${suffix}`,
    )
    .replace(/(\bimport\s*\(\s*["'])(\.[^"']+)(["']\s*\))/g, (_match, prefix: string, specifier: string, suffix: string) =>
      `${prefix}${toVersionedUrl(specifier)}${suffix}`,
    );
}

async function importRuntimeEntryModule(workspaceRoot: string, absolutePath: string): Promise<Record<string, unknown>> {
  if (!runtimeEntryCacheEnabled) {
    return importRuntimeModule(versionedRuntimeFileUrl(absolutePath));
  }

  if (activeRuntimeImporter) {
    refreshRuntimeModuleNamespace("entry");
  } else {
    runtimeImportSequence += 1;
  }
  const source = nodeFileSystem.readText(absolutePath);
  if (source === null) {
    throw new Error(`runtime entry file not found: ${absolutePath}`);
  }
  const rewritten = rewriteRelativeRuntimeImports(source, absolutePath);
  const transpiled = ts.transpileModule(rewritten, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: absolutePath,
  });
  const relativePath = relative(workspaceRoot, absolutePath).replace(/\\/g, "/");
  runtimeEntryImportNonce += 1;
  const cachePath = join(
    workspaceRoot,
    ".forge",
    "runtime-cache",
    runtimeCacheInstance,
    String(runtimeImportSequence),
    String(runtimeEntryImportNonce),
    relativePath.replace(/\.[cm]?[jt]sx?$/, ".mjs"),
  );
  nodeFileSystem.writeText(cachePath, transpiled.outputText);
  return (await import(versionedRuntimeFileUrl(cachePath))) as Record<string, unknown>;
}

function snapshotEnv(): Record<string, string | undefined> {
  return { ...process.env };
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export async function prepareRuntimeEnvironment(
  workspaceRoot: string,
  options: PrepareRuntimeEnvironmentOptions,
): Promise<() => void> {
  const envSnapshot = snapshotEnv();
  const previousActiveDbAdapter = activeDbAdapter;

  const useMock = options.mock || process.env.FORGE_MOCK === "1";
  if (useMock) {
    await applyMocks(workspaceRoot, loadForgeLock(workspaceRoot));
  }

  if (options.mockAi || process.env.FORGE_MOCK_AI === "1") {
    process.env.FORGE_MOCK_AI = "1";
  }

  activeDbAdapter = options.db ?? null;

  return () => {
    activeDbAdapter = previousActiveDbAdapter;
    restoreEnv(envSnapshot);
  };
}

export function getActiveDbAdapter(): DbAdapter | null {
  return activeDbAdapter;
}

async function guardPreflight(
  workspaceRoot: string,
  entry: RuntimeEntry,
): Promise<Diagnostic[]> {
  const ctx = discover({ workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });

  const matrix = await loadRuntimeMatrix(workspaceRoot);
  const violations = checkImportGuards(appGraph.moduleGraph, matrix);
  const closure = moduleClosure(appGraph.moduleGraph, entry.moduleId);
  const allowedFiles = filesForModuleClosure(appGraph.moduleGraph, closure);

  return violations.filter(
    (diagnostic) => diagnostic.file !== undefined && allowedFiles.has(diagnostic.file),
  );
}

export function listEntries(workspaceRoot: string): ListEntriesResult {
  const { graph, diagnostics } = loadRuntimeGraph(workspaceRoot);
  if (!graph) {
    return { entries: [], diagnostics, exitCode: 1 };
  }

  return {
    entries: graph.entries,
    diagnostics,
    exitCode: 0,
  };
}

export async function runEntry(
  workspaceRoot: string,
  name: string,
  options: RunEntryOptions,
): Promise<RunEntryResult> {
  const { graph, diagnostics } = loadRuntimeGraph(workspaceRoot);
  if (!graph) {
    return { ok: false, diagnostics, exitCode: 1 };
  }

  const entry = graph.entries.find((candidate) => candidate.name === name);
  if (!entry) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_NOT_FOUND,
          message: `runtime entry '${name}' not found`,
        }),
      ],
      exitCode: 1,
    };
  }

  const guardViolations = await guardPreflight(workspaceRoot, entry);
  if (guardViolations.length > 0) {
    return {
      ok: false,
      entry,
      diagnostics: guardBlockedDiagnostics(entry, guardViolations, diagnostics),
      exitCode: 1,
    };
  }

  const db = Object.prototype.hasOwnProperty.call(options, "db")
    ? (options.db ?? null)
    : activeDbAdapter;

  const envSnapshot = snapshotEnv();
  const previousActiveDbAdapter = activeDbAdapter;

  try {
    await prepareRuntimeEnvironment(workspaceRoot, {
      mock: options.mock,
      db,
    });

    const absolutePath = join(workspaceRoot, entry.file);
    const mod = await importRuntimeEntryModule(workspaceRoot, absolutePath);
    const resolved = resolveHandlerFromModule(mod, entry.name);

    if (!resolved) {
      return {
        ok: false,
        entry,
        diagnostics: [
          ...diagnostics,
          createDiagnostic({
            severity: "error",
            code: FORGE_RUNTIME_NOT_FOUND,
            message: `export '${entry.name}' is not a callable handler`,
            file: entry.file,
          }),
        ],
        exitCode: 1,
      };
    }

    const auth =
      options.auth ??
      resolveAuthFromCli({
        userId: options.userId,
        tenantId: options.tenantId,
        role: options.role,
      });

    const runtime: RunEntryRuntime = {
      adapter: db,
      tableMap: loadTableMap(workspaceRoot) ?? undefined,
      workspaceRoot,
      auth,
      liveManager: options.liveManager,
    };

    const executed = await executeResolvedEntry(
      workspaceRoot,
      entry,
      resolved,
      { ...options, auth },
      runtime,
    );

    return {
      ok: executed.ok,
      result: executed.result,
      entry,
      diagnostics: [...diagnostics, ...executed.diagnostics],
      exitCode: executed.ok ? 0 : 1,
      traceId: "traceId" in executed ? (executed as { traceId?: string }).traceId : undefined,
    };
  } finally {
    activeDbAdapter = previousActiveDbAdapter;
    restoreEnv(envSnapshot);
  }
}
