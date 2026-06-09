import { lookupMatrixEntry } from "../classifier/runtime-matrix.ts";
import { forgeGuardViolation } from "../diagnostics/create.ts";
import type { ModuleGraph } from "../types/app-graph.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import type { RuntimeMatrix } from "../types/runtime-matrix.ts";
import { comparePaths } from "../primitives/paths.ts";
import { compareBytes } from "../primitives/compare.ts";
import { propagateContexts } from "./propagate-contexts.ts";

function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  let cmp = comparePaths(a.file ?? "", b.file ?? "");
  if (cmp !== 0) {
    return cmp;
  }

  cmp = (a.span?.start ?? 0) - (b.span?.start ?? 0);
  if (cmp !== 0) {
    return cmp;
  }

  const aPackage = extractPackageName(a.message);
  const bPackage = extractPackageName(b.message);
  cmp = compareBytes(aPackage, bPackage);
  if (cmp !== 0) {
    return cmp;
  }

  const aContext = extractContext(a.message);
  const bContext = extractContext(b.message);
  return compareBytes(aContext, bContext);
}

function extractPackageName(message: string): string {
  const match = /^'([^']+)' is not allowed/.exec(message);
  return match?.[1] ?? "";
}

function extractContext(message: string): string {
  const match = /'([^']+)' context/.exec(message);
  return match?.[1] ?? "";
}

/**
 * Evaluate package imports against the runtime matrix after propagating effective contexts.
 */
export function checkImportGuards(
  moduleGraph: ModuleGraph,
  matrix: RuntimeMatrix,
): Diagnostic[] {
  propagateContexts(moduleGraph);

  const diagnostics: Diagnostic[] = [];
  const recorded = new Set<string>();

  for (const node of moduleGraph.nodes) {
    if (node.effectiveContexts.length === 0) {
      continue;
    }

    for (const imp of node.directPackageImports) {
      const entry = lookupMatrixEntry(matrix, imp.packageName);
      if (entry == null) {
        continue;
      }

      for (const context of node.effectiveContexts) {
        if (!entry.compatible.includes(context)) {
          const key = `${node.file}\0${imp.packageName}\0${context}\0${imp.span.start}`;
          if (recorded.has(key)) {
            continue;
          }
          recorded.add(key);

          const rationale =
            entry.rationale[context] ??
            "package is incompatible with this runtime context";
          diagnostics.push(
            forgeGuardViolation(
              imp.packageName,
              context,
              rationale,
              node.file,
              imp.span,
            ),
          );
        }
      }
    }
  }

  diagnostics.sort(compareDiagnostics);
  return diagnostics;
}

export function isContextViolating(
  matrix: RuntimeMatrix,
  packageName: string,
  context: RuntimeContext,
): boolean {
  const entry = lookupMatrixEntry(matrix, packageName);
  if (entry == null) {
    return false;
  }
  return !entry.compatible.includes(context);
}
