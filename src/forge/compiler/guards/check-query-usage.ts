import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_QUERY_AI_FORBIDDEN,
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_SECRET_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
} from "../diagnostics/codes.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { Diagnostic } from "../types/diagnostic.ts";

const WRITE_PATTERN =
  /ctx\.db\.[\w$]+\.(insert|update|delete)\s*\(/;
const EMIT_PATTERN = /ctx\.emit\s*\(/;
const SECRETS_PATTERN = /ctx\.secrets\b/;
const AI_PATTERN = /ctx\.ai\b/;

export function checkQueryUsageInApp(appGraph: AppGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const recorded = new Set<string>();

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "query") {
      continue;
    }

    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    const checks: Array<{ pattern: RegExp; code: Diagnostic["code"]; message: string }> = [
      {
        pattern: WRITE_PATTERN,
        code: FORGE_QUERY_WRITE_FORBIDDEN,
        message: "queries cannot perform write operations on ctx.db",
      },
      {
        pattern: EMIT_PATTERN,
        code: FORGE_QUERY_EMIT_FORBIDDEN,
        message: "queries cannot call ctx.emit",
      },
      {
        pattern: SECRETS_PATTERN,
        code: FORGE_QUERY_SECRET_FORBIDDEN,
        message: "queries cannot access ctx.secrets",
      },
      {
        pattern: AI_PATTERN,
        code: FORGE_QUERY_AI_FORBIDDEN,
        message: "queries cannot access ctx.ai",
      },
    ];

    for (const check of checks) {
      if (!check.pattern.test(sourceSlice)) {
        continue;
      }

      const key = `${symbol.file}:${check.code}`;
      if (recorded.has(key)) {
        continue;
      }
      recorded.add(key);

      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: check.code,
          message: check.message,
          file: symbol.file,
          span: symbol.span,
        }),
      );
    }
  }

  return diagnostics;
}
