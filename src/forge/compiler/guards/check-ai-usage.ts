import { createDiagnostic } from "../diagnostics/create.ts";
import {
  FORGE_AI_DYNAMIC_PROVIDER,
  FORGE_AI_FORBIDDEN_CONTEXT,
  FORGE_AI_MODEL_MISSING,
} from "../diagnostics/codes.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import { detectCtxAiUsage, parseAiCallsFromSlice } from "../ai-registry/parse.ts";
import { propagateContexts } from "./propagate-contexts.ts";

const FORBIDDEN_AI_CONTEXTS: RuntimeContext[] = [
  "command",
  "client",
  "query",
  "liveQuery",
  "shared",
  "edge",
];

const DYNAMIC_PROVIDER_PATTERN =
  /provider\s*:\s*(?:process\.env|ctx\.config|ctx\.secrets|\w+\[)/;

function contextsForFile(
  appGraph: AppGraph,
  file: string,
): RuntimeContext[] {
  const node = appGraph.moduleGraph.nodes.find((candidate) => candidate.file === file);
  return node?.effectiveContexts ?? [];
}

export function checkAiUsageInApp(appGraph: AppGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const recorded = new Set<string>();

  propagateContexts(appGraph.moduleGraph);

  for (const symbol of appGraph.symbols) {
    const contexts = contextsForFile(appGraph, symbol.file);
    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    if (!detectCtxAiUsage(sourceSlice)) {
      continue;
    }

    const forbidden = contexts.filter((ctx) => FORBIDDEN_AI_CONTEXTS.includes(ctx));
    for (const ctx of forbidden) {
      const key = `${symbol.file}:${ctx}:forbidden`;
      if (recorded.has(key)) continue;
      recorded.add(key);

      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_AI_FORBIDDEN_CONTEXT,
          message: `ctx.ai is forbidden in '${ctx}' context`,
          file: symbol.file,
        }),
      );
    }

    if (DYNAMIC_PROVIDER_PATTERN.test(sourceSlice)) {
      const key = `${symbol.file}:dynamic`;
      if (!recorded.has(key)) {
        recorded.add(key);
        diagnostics.push(
          createDiagnostic({
            severity: "warning",
            code: FORGE_AI_DYNAMIC_PROVIDER,
            message: "dynamic AI provider selection detected; prefer static provider literals",
            file: symbol.file,
          }),
        );
      }
    }

    for (const call of parseAiCallsFromSlice(sourceSlice)) {
      if (!call.model) {
        const key = `${symbol.file}:${call.method}:model`;
        if (!recorded.has(key)) {
          recorded.add(key);
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: FORGE_AI_MODEL_MISSING,
              message: `ctx.ai.${call.method} missing explicit model`,
              file: symbol.file,
            }),
          );
        }
      }
    }
  }

  return diagnostics;
}
