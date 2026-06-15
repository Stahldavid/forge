import { join } from "node:path";
import type {
  ExportKind,
  ExportSignature,
  PackageApi,
  PackageMetadata,
  PackageRuntimeCompatibility,
  RuntimeTypeMismatch,
} from "../types/package-graph.ts";
import type { RuntimeExportKind } from "../types/sandbox.ts";
import { stableSortStrings } from "../primitives/sort.ts";
import { nodeFileSystem } from "../fs/index.ts";
import { readTextFile } from "./read-file.ts";

const INSTALL_SCRIPT_NAMES = new Set(["preinstall", "install", "postinstall", "prepare"]);
const NATIVE_HINTS = ["node-gyp", "prebuild", "node-pre-gyp", "cmake-js"];

export interface PackageApiSymbol {
  package: string;
  version: string;
  entrypoint: string;
  name: string;
  kind: ExportKind;
  signature: string;
  overloads: string[];
  declarations: string[];
  jsdoc: ExportSignature["jsdoc"];
  examples: string[];
  classification: ExportSignature["classification"];
}

export interface DependencyApiSummary {
  package: string;
  version: string;
  source: PackageApi["source"];
  entrypoints: Array<{
    subpath: string;
    dtsPath: string | null;
    conditions: string[];
    exportCount: number;
    exports: string[];
  }>;
  symbols: PackageApiSymbol[];
  runtimeTypeMismatches: RuntimeTypeMismatch[];
  runtimeCompatibility: PackageRuntimeCompatibility;
  metadata: PackageMetadata;
}

export function readPackageMetadata(installPath: string, exportSubpathCount: number): PackageMetadata {
  const raw = readTextFile(join(installPath, "package.json"));
  const pkg = JSON.parse(raw) as {
    type?: string;
    main?: string;
    module?: string;
    browser?: string | boolean | Record<string, string | false>;
    types?: string;
    typings?: string;
    engines?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalPeerDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const scripts = pkg.scripts ?? {};
  const scriptText = Object.entries(scripts)
    .map(([name, value]) => `${name}:${value}`)
    .join("\n")
    .toLowerCase();
  const dependencies = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
  const dependencyNames = Object.keys(dependencies).map((name) => name.toLowerCase());
  const hasInstallScripts = Object.keys(scripts).some((name) => INSTALL_SCRIPT_NAMES.has(name));
  const hasNativeBindings =
    NATIVE_HINTS.some((hint) => scriptText.includes(hint)) ||
    dependencyNames.some((name) => NATIVE_HINTS.includes(name)) ||
    hasNativeBinary(installPath);

  return {
    ...(pkg.type === "module" || pkg.type === "commonjs" ? { type: pkg.type } : {}),
    engines: sortRecord(pkg.engines ?? {}),
    entryFields: {
      ...(typeof pkg.main === "string" ? { main: pkg.main } : {}),
      ...(typeof pkg.module === "string" ? { module: pkg.module } : {}),
      ...(typeof pkg.browser === "string" || typeof pkg.browser === "boolean" ? { browser: pkg.browser } : {}),
      ...(typeof pkg.types === "string"
        ? { types: pkg.types }
        : typeof pkg.typings === "string"
          ? { types: pkg.typings }
          : {}),
    },
    peerDependencies: stableSortStrings(Object.keys(pkg.peerDependencies ?? {})),
    optionalPeerDependencies: stableSortStrings(Object.keys(pkg.optionalPeerDependencies ?? {})),
    hasInstallScripts,
    hasNativeBindings,
    exportSubpathCount,
  };
}

export function buildRuntimeCompatibility(metadata: PackageMetadata): PackageRuntimeCompatibility {
  const reasons: string[] = [];
  const risks: string[] = [];
  let node: PackageRuntimeCompatibility["node"] = "compatible";
  let bun: PackageRuntimeCompatibility["bun"] = "compatible";
  let browser: PackageRuntimeCompatibility["browser"] = metadata.entryFields.browser ? "compatible" : "unknown";
  let edge: PackageRuntimeCompatibility["edge"] = "unknown";

  if (metadata.type === "module") {
    reasons.push("package declares ESM via package.json type=module");
  }
  if (metadata.engines.node) {
    reasons.push(`package declares node engine ${metadata.engines.node}`);
  }
  if (metadata.entryFields.browser) {
    reasons.push("package declares a browser entry");
    edge = "risky";
  }
  if (metadata.hasInstallScripts) {
    risks.push("package has install lifecycle scripts");
    bun = "risky";
  }
  if (metadata.hasNativeBindings) {
    risks.push("package appears to use native bindings or native build tooling");
    bun = "risky";
    browser = "risky";
    edge = "risky";
  }
  if (metadata.engines.bun) {
    reasons.push(`package declares bun engine ${metadata.engines.bun}`);
    bun = "compatible";
  }
  if (metadata.engines.node && metadata.engines.node.includes("<")) {
    risks.push("node engine range may exclude modern Node versions");
    node = "risky";
  }
  if (metadata.entryFields.browser === false) {
    browser = "risky";
    risks.push("package explicitly disables browser entry support");
  }

  return {
    node,
    bun,
    browser,
    edge,
    reasons: stableSortStrings(reasons),
    risks: stableSortStrings(risks),
  };
}

export function runtimeTypeMismatches(api: Pick<PackageApi, "entrypoints" | "runtimeShape">): RuntimeTypeMismatch[] {
  if (!api.runtimeShape) {
    return [];
  }
  const typeEntrypoints = new Map(api.entrypoints.map((entrypoint) => [entrypoint.subpath, entrypoint]));
  const runtimeEntrypoints = new Map(api.runtimeShape.entrypoints.map((entrypoint) => [entrypoint.subpath, entrypoint]));
  const mismatches: RuntimeTypeMismatch[] = [];

  for (const [subpath, typeEntrypoint] of typeEntrypoints) {
    const runtimeEntrypoint = runtimeEntrypoints.get(subpath);
    if (!runtimeEntrypoint) {
      for (const exported of typeEntrypoint.exports) {
        mismatches.push({
          entrypoint: subpath,
          exportName: exported.name,
          kind: "types-only",
          typesKind: exported.kind,
        });
      }
      continue;
    }
    const runtimeExports = new Map(runtimeEntrypoint.exports.map((exported) => [exported.name, exported]));
    for (const exported of typeEntrypoint.exports) {
      const runtimeExport = runtimeExports.get(exported.name);
      if (!runtimeExport) {
        mismatches.push({
          entrypoint: subpath,
          exportName: exported.name,
          kind: "types-only",
          typesKind: exported.kind,
        });
        continue;
      }
      if (!kindsCompatible(exported.kind, runtimeExport.kind)) {
        mismatches.push({
          entrypoint: subpath,
          exportName: exported.name,
          kind: "kind-mismatch",
          typesKind: exported.kind,
          runtimeKind: runtimeExport.kind,
        });
      }
    }
  }

  for (const [subpath, runtimeEntrypoint] of runtimeEntrypoints) {
    const typeEntrypoint = typeEntrypoints.get(subpath);
    const typeExports = new Set(typeEntrypoint?.exports.map((exported) => exported.name) ?? []);
    for (const runtimeExport of runtimeEntrypoint.exports) {
      if (!typeExports.has(runtimeExport.name)) {
        mismatches.push({
          entrypoint: subpath,
          exportName: runtimeExport.name,
          kind: "runtime-only",
          runtimeKind: runtimeExport.kind,
        });
      }
    }
  }

  return mismatches.sort((a, b) =>
    `${a.entrypoint}:${a.exportName}:${a.kind}`.localeCompare(`${b.entrypoint}:${b.exportName}:${b.kind}`),
  );
}

export function summarizeDependencyApi(api: PackageApi, symbolName?: string): DependencyApiSummary {
  const symbols = flattenPackageSymbols(api)
    .filter((symbol) => !symbolName || symbol.name === symbolName)
    .sort((a, b) => `${a.entrypoint}:${a.name}`.localeCompare(`${b.entrypoint}:${b.name}`));
  return {
    package: api.name,
    version: api.version,
    source: api.source,
    entrypoints: api.entrypoints.map((entrypoint) => ({
      subpath: entrypoint.subpath,
      dtsPath: entrypoint.dtsPath,
      conditions: entrypoint.conditions,
      exportCount: entrypoint.exports.length,
      exports: entrypoint.exports.map((exported) => exported.name).sort(),
    })),
    symbols,
    runtimeTypeMismatches: api.runtimeTypeMismatches ?? [],
    runtimeCompatibility: api.runtimeCompatibility ?? defaultRuntimeCompatibility(),
    metadata: api.metadata ?? defaultPackageMetadata(api.entrypoints.length),
  };
}

export function flattenPackageSymbols(api: PackageApi): PackageApiSymbol[] {
  return api.entrypoints.flatMap((entrypoint) =>
    entrypoint.exports.map((exported) => ({
      package: api.name,
      version: api.version,
      entrypoint: entrypoint.subpath,
      name: exported.name,
      kind: exported.kind,
      signature: exported.signature,
      overloads: exported.overloads ?? [],
      declarations: exported.declarations ?? [],
      jsdoc: exported.jsdoc,
      examples: exported.examples,
      classification: exported.classification,
    })),
  );
}

export function traceForPackage(api: PackageApi): Array<{ entrypoint: string; trace: PackageApi["entrypoints"][number]["resolutionTrace"] }> {
  return api.entrypoints.map((entrypoint) => ({
    entrypoint: entrypoint.subpath,
    trace: entrypoint.resolutionTrace ?? [],
  }));
}

function kindsCompatible(typeKind: ExportKind, runtimeKind: RuntimeExportKind): boolean {
  if (runtimeKind === "unknown") {
    return true;
  }
  if (typeKind === "function" && runtimeKind === "function") {
    return true;
  }
  if (typeKind === "class" && runtimeKind === "class") {
    return true;
  }
  if ((typeKind === "const" || typeKind === "namespace") && (runtimeKind === "const" || runtimeKind === "object")) {
    return true;
  }
  return false;
}

export function defaultRuntimeCompatibility(): PackageRuntimeCompatibility {
  return {
    node: "unknown",
    bun: "unknown",
    browser: "unknown",
    edge: "unknown",
    reasons: [],
    risks: [],
  };
}

export function defaultPackageMetadata(exportSubpathCount: number): PackageMetadata {
  return {
    engines: {},
    entryFields: {},
    peerDependencies: [],
    optionalPeerDependencies: [],
    hasInstallScripts: false,
    hasNativeBindings: false,
    exportSubpathCount,
  };
}

function sortRecord(input: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function hasNativeBinary(dir: string, depth = 0): boolean {
  if (depth > 4 || !nodeFileSystem.exists(dir)) {
    return false;
  }
  for (const entry of nodeFileSystem.readDir(dir)) {
    if (entry.name === "node_modules" || entry.name === ".git") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory) {
      if (hasNativeBinary(full, depth + 1)) {
        return true;
      }
    } else if (entry.name.endsWith(".node") || entry.name === "binding.gyp") {
      return true;
    }
  }
  return false;
}
