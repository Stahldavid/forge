import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { CairParsedAction, CairSymbolRef } from "./types.ts";

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

function actionError(message: string, file?: string): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: "FORGE_CAIR_ACTION",
    message,
    ...(file ? { file } : {}),
  });
}

export function validateSemanticExpectations(
  action: CairParsedAction,
  symbol: CairSymbolRef,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const expectedFile = action.args["expect.file"];
  const expectedKind = action.args["expect.kind"];
  const expectedHash = action.args["expect.hash"];
  if (!expectedFile || !expectedKind || !expectedHash) {
    diagnostics.push(actionError(`${action.verb} requires expect.file, expect.kind, and expect.hash`, symbol.file));
    return diagnostics;
  }
  if (normalizeSlashes(expectedFile) !== normalizeSlashes(symbol.file)) {
    diagnostics.push(actionError(`expect.file mismatch: expected ${expectedFile}, got ${symbol.file}`, symbol.file));
  }
  if (expectedKind !== symbol.kind) {
    diagnostics.push(actionError(`expect.kind mismatch: expected ${expectedKind}, got ${symbol.kind}`, symbol.file));
  }
  if (expectedHash !== symbol.hash) {
    diagnostics.push(actionError(`expect.hash mismatch: expected ${expectedHash}, got ${symbol.hash}`, symbol.file));
  }
  return diagnostics;
}
