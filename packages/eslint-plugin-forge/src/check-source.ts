import { lookupMatrixEntry } from "../../../src/forge/compiler/classifier/runtime-matrix.ts";
import type { ImportGuardsArtifact } from "../../../src/forge/compiler/types/import-guards.ts";
import type { RuntimeContext } from "../../../src/forge/compiler/types/runtime.ts";
import type { RuntimeMatrix } from "../../../src/forge/compiler/types/runtime-matrix.ts";
import { parsePackageSpecifier } from "../../../src/forge/compiler/app-graph/module-graph.ts";

export interface ForgeGuardSourceViolation {
  packageName: string;
  context: RuntimeContext;
  rationale: string;
  line: number;
  column: number;
  endColumn: number;
}

const IMPORT_PATTERN =
  /(?:import\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?|export\s+(?:type\s+)?(?:[\w*{}\s,]+from\s+)?)['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function lineColumnAtOffset(
  source: string,
  offset: number,
): { line: number; column: number } {
  const before = source.slice(0, offset);
  const lines = before.split("\n");
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function effectiveContextsForFile(
  file: string,
  guards: ImportGuardsArtifact,
): RuntimeContext[] {
  const normalized = file.replace(/\\/g, "/");
  const entry = guards.moduleContexts.find(
    (module) =>
      module.file === normalized ||
      normalized.endsWith(`/${module.file}`) ||
      module.file.endsWith(normalized),
  );
  return entry?.effectiveContexts ?? [];
}

export function checkSourceForgeGuards(
  filePath: string,
  source: string,
  importGuards: ImportGuardsArtifact,
  runtimeMatrix: RuntimeMatrix,
): ForgeGuardSourceViolation[] {
  const effectiveContexts = effectiveContextsForFile(filePath, importGuards);
  if (effectiveContexts.length === 0) {
    return [];
  }

  const violations: ForgeGuardSourceViolation[] = [];

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) {
      continue;
    }

    const parsed = parsePackageSpecifier(specifier);
    if (!parsed) {
      continue;
    }

    const matrixEntry = lookupMatrixEntry(runtimeMatrix, parsed.packageName);
    if (matrixEntry == null) {
      continue;
    }

    const offset = match.index ?? 0;
    const start = lineColumnAtOffset(source, offset);
    const endColumn = start.column + match[0].length;

    for (const context of effectiveContexts) {
      if (!matrixEntry.compatible.includes(context)) {
        violations.push({
          packageName: parsed.packageName,
          context,
          rationale:
            matrixEntry.rationale[context] ??
            "package is incompatible with this runtime context",
          line: start.line,
          column: start.column,
          endColumn,
        });
      }
    }
  }

  return violations;
}
