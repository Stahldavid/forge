import { isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";
import { canonicalJson } from "../primitives/serialize.ts";
import { hashStable } from "../primitives/hash.ts";
import { normalizePath } from "../primitives/paths.ts";

const RELEVANT_COMPILER_OPTIONS: (keyof ts.CompilerOptions)[] = [
  "baseUrl",
  "paths",
  "module",
  "moduleResolution",
  "target",
  "jsx",
  "allowJs",
  "resolveJsonModule",
  "esModuleInterop",
  "strict",
  "rootDir",
  "outDir",
];

const WORKSPACE_PATH_OPTIONS = new Set<keyof ts.CompilerOptions>([
  "baseUrl",
  "rootDir",
  "outDir",
]);

function canonicalWorkspacePath(value: string, workspaceRoot: string): string {
  if (!isAbsolute(value)) {
    return normalizePath(value);
  }
  const relativePath = normalizePath(relative(resolve(workspaceRoot), value));
  return relativePath || ".";
}

function canonicalPathsOption(paths: ts.MapLike<string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(paths).map(([key, values]) => [
      key,
      values.map((value) => normalizePath(value)),
    ]),
  );
}

export function hashTsCompilerOptions(
  options: ts.CompilerOptions,
  workspaceRoot?: string,
): string {
  const relevant: Record<string, unknown> = {};
  for (const key of RELEVANT_COMPILER_OPTIONS) {
    const value = options[key];
    if (value === undefined) {
      continue;
    }
    if (workspaceRoot && WORKSPACE_PATH_OPTIONS.has(key) && typeof value === "string") {
      relevant[key] = canonicalWorkspacePath(value, workspaceRoot);
      continue;
    }
    if (key === "paths" && typeof value === "object" && value !== null) {
      relevant[key] = canonicalPathsOption(value as ts.MapLike<string[]>);
      continue;
    }
    relevant[key] = value;
  }
  return hashStable(canonicalJson(relevant));
}

export function loadTsconfig(
  workspaceRoot: string,
  tsconfigPath?: string,
): ts.ParsedCommandLine {
  const configPath =
    tsconfigPath ?? ts.findConfigFile(workspaceRoot, ts.sys.fileExists, "tsconfig.json");

  if (!configPath) {
    return {
      options: {},
      fileNames: [],
      errors: [],
    };
  }

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  return ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    workspaceRoot,
    undefined,
    configPath,
  );
}

export function hashTsconfigForWorkspace(
  workspaceRoot: string,
  tsconfigPath?: string,
): string {
  const parsed = loadTsconfig(workspaceRoot, tsconfigPath);
  return hashTsCompilerOptions(parsed.options, workspaceRoot);
}
