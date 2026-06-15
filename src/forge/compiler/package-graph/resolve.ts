import { join } from "node:path";
import ts from "typescript";
import type { ResolutionMode } from "../types/runtime.ts";
import { readTextFile } from "./read-file.ts";

export interface ResolvedEntrypoint {
  dtsPath: string | null;
  conditions: string[];
}

export function createResolutionCompilerOptions(
  mode: ResolutionMode,
): ts.CompilerOptions {
  return {
    moduleResolution:
      mode === "nodenext"
        ? ts.ModuleResolutionKind.NodeNext
        : ts.ModuleResolutionKind.Bundler,
    resolvePackageJsonExports: true,
    resolvePackageJsonImports: true,
    customConditions: ["types"],
    noEmit: true,
    types: [],
    skipLibCheck: true,
  };
}

export function moduleSpecifierForSubpath(
  packageName: string,
  subpath: string,
): string {
  if (subpath === ".") {
    return packageName;
  }
  const trimmed = subpath.startsWith("./") ? subpath.slice(2) : subpath;
  return `${packageName}/${trimmed}`;
}

export function resolveEntrypointTypes(
  installPath: string,
  packageName: string,
  subpath: string,
  mode: ResolutionMode,
): ResolvedEntrypoint {
  const containingFile = join(installPath, "package.json");
  const specifier = moduleSpecifierForSubpath(packageName, subpath);
  const options = createResolutionCompilerOptions(mode);

  const result = ts.resolveModuleName(
    specifier,
    containingFile,
    options,
    ts.sys,
  );

  const resolved = result.resolvedModule;
  if (resolved == null) {
    return { dtsPath: null, conditions: [] };
  }

  const dtsPath = pickTypesPath(resolved);
  const conditions = extractConditions(resolved);

  return { dtsPath, conditions };
}

function pickTypesPath(resolved: ts.ResolvedModuleFull): string | null {
  if (resolved.extension === ts.Extension.Dts) {
    return resolved.resolvedFileName;
  }
  if (resolved.extension === ts.Extension.Ts) {
    return resolved.resolvedFileName;
  }
  if (resolved.extension === ts.Extension.Tsx) {
    return resolved.resolvedFileName;
  }
  return isDeclarationPath(resolved.resolvedFileName)
    ? resolved.resolvedFileName
    : null;
}

function isDeclarationPath(path: string): boolean {
  return path.endsWith(".d.ts") || path.endsWith(".d.cts") || path.endsWith(".d.mts");
}

function extractConditions(resolved: ts.ResolvedModuleFull): string[] {
  const conditions = (resolved as { packageId?: { conditions?: string[] } })
    .packageId?.conditions;
  if (Array.isArray(conditions) && conditions.length > 0) {
    return [...conditions];
  }
  return [];
}

export function typesPackageName(packageName: string): string {
  if (packageName.startsWith("@")) {
    return `@types/${packageName.slice(1).replace("/", "__")}`;
  }
  return `@types/${packageName}`;
}

export function resolveTypesPackage(
  typesPackageName: string,
  installPath: string,
  mode: ResolutionMode,
): string | null {
  const typesInstallPath = join(installPath, "..", typesPackageName);
  const packageJsonPath = join(typesInstallPath, "package.json");

  try {
    readTextFile(packageJsonPath);
  } catch {
    return null;
  }

  const directIndex = join(typesInstallPath, "index.d.ts");
  try {
    readTextFile(directIndex);
    return directIndex;
  } catch {
    // fall through to module resolver
  }

  const resolved = resolveEntrypointTypes(
    typesInstallPath,
    typesPackageName,
    ".",
    mode,
  );
  return resolved.dtsPath;
}
