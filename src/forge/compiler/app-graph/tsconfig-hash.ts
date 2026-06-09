import ts from "typescript";
import { canonicalJson } from "../primitives/serialize.ts";
import { hashStable } from "../primitives/hash.ts";

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

export function hashTsCompilerOptions(options: ts.CompilerOptions): string {
  const relevant: Record<string, unknown> = {};
  for (const key of RELEVANT_COMPILER_OPTIONS) {
    const value = options[key];
    if (value !== undefined) {
      relevant[key] = value;
    }
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
  return hashTsCompilerOptions(parsed.options);
}
