import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { FORGE_GUARD_VIOLATION } from "../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import {
  checkSourceForgeGuards,
  loadForgeGuardArtifacts,
} from "../../../packages/eslint-plugin-forge/index.ts";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "_generated", ".forge", "dist", "build"]);

function collectSourceFiles(workspaceRoot: string, root: string): string[] {
  const absoluteRoot = join(workspaceRoot, root);
  if (!existsSync(absoluteRoot)) {
    return [];
  }

  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (SKIP_DIRS.has(entry)) {
          continue;
        }
        walk(absolute);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(entry.slice(entry.lastIndexOf(".")))) {
        files.push(relative(workspaceRoot, absolute).replace(/\\/g, "/"));
      }
    }
  }

  walk(absoluteRoot);
  return files.sort();
}

export async function lintForgeGuards(workspaceRoot: string): Promise<{
  exitCode: 0 | 1;
  diagnostics: Diagnostic[];
}> {
  const importGuardsPath = join(
    workspaceRoot,
    GENERATED_DIR,
    "importGuards.json",
  );
  const runtimeMatrixPath = join(
    workspaceRoot,
    GENERATED_DIR,
    "runtimeMatrix.json",
  );

  if (!existsSync(importGuardsPath) || !existsSync(runtimeMatrixPath)) {
    return {
      exitCode: 0,
      diagnostics: [
        createDiagnostic({
          severity: "warning",
          code: "FORGE_VERIFY_LINT_SKIP",
          message:
            "skipping forge guard lint: run forge generate first to create importGuards.json and runtimeMatrix.json",
        }),
      ],
    };
  }

  const artifacts = loadForgeGuardArtifacts(importGuardsPath, runtimeMatrixPath);
  const diagnostics: Diagnostic[] = [];

  for (const root of ["src", "tests", "examples"]) {
    for (const file of collectSourceFiles(workspaceRoot, root)) {
      const source = readFileSync(join(workspaceRoot, file), "utf8");
      const violations = checkSourceForgeGuards(
        file,
        source,
        artifacts.importGuards,
        artifacts.runtimeMatrix,
      );

      for (const violation of violations) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: FORGE_GUARD_VIOLATION,
            message: `'${violation.packageName}' is not allowed in '${violation.context}' context: ${violation.rationale}`,
            file,
            span: {
              start: violation.column,
              end: violation.endColumn,
            },
          }),
        );
      }
    }
  }

  return {
    exitCode: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
    diagnostics,
  };
}

if (import.meta.main) {
  const result = await lintForgeGuards(process.cwd());
  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.file ? ` ${diagnostic.file}` : "";
    console.log(
      `${diagnostic.severity} ${diagnostic.code}:${location} ${diagnostic.message}`,
    );
  }
  process.exit(result.exitCode);
}
