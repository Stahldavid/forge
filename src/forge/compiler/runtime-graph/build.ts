import { createDiagnostic } from "../diagnostics/create.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { RuntimeEntry, RuntimeGraph } from "../types/runtime-graph.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import {
  RUNTIME_GRAPH_ANALYZER_VERSION,
  RUNTIME_GRAPH_SCHEMA_VERSION,
} from "./constants.ts";

const RUNTIME_KINDS = new Set(["command", "action"]);

function stableSortEntries(entries: RuntimeEntry[]): RuntimeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function moduleIdForFile(
  moduleGraph: AppGraph["moduleGraph"],
  file: string,
): string | null {
  const node = moduleGraph.nodes.find((candidate) => candidate.file === file);
  return node?.id ?? null;
}

function dependenciesForModule(
  moduleGraph: AppGraph["moduleGraph"],
  moduleId: string,
): string[] {
  const node = moduleGraph.nodes.find((candidate) => candidate.id === moduleId);
  if (!node) {
    return [];
  }

  const deps = node.localImports.map((imp) => imp.toModuleId);
  return [...new Set(deps)].sort();
}

function detectDuplicateEntryNames(entries: RuntimeEntry[]): RuntimeGraph["diagnostics"] {
  const byName = new Map<string, RuntimeEntry[]>();

  for (const entry of entries) {
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }

  const diagnostics: RuntimeGraph["diagnostics"] = [];

  for (const [name, group] of byName) {
    if (group.length <= 1) {
      continue;
    }

    for (const entry of group) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DUP_RUNTIME_ENTRY",
          message: `duplicate runtime entry name '${name}'`,
          file: entry.file,
        }),
      );
    }
  }

  return diagnostics.sort((a, b) => {
    const fileA = a.file ?? "";
    const fileB = b.file ?? "";
    if (fileA !== fileB) {
      return fileA < fileB ? -1 : 1;
    }
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
  });
}

export function buildRuntimeGraph(appGraph: AppGraph): RuntimeGraph {
  const entries: RuntimeEntry[] = [];
  const diagnostics: RuntimeGraph["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (!RUNTIME_KINDS.has(symbol.kind)) {
      continue;
    }

    const kind = symbol.kind as "command" | "action";
    const moduleId = moduleIdForFile(appGraph.moduleGraph, symbol.file);

    if (moduleId === null) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_RUNTIME_UNRESOLVABLE",
          message: `cannot resolve module for runtime entry '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
      continue;
    }

    entries.push({
      id: symbol.id,
      kind,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      file: symbol.file,
      moduleId,
      runtimeContext: kind,
      dependencies: dependenciesForModule(appGraph.moduleGraph, moduleId),
    });
  }

  const dupDiagnostics = detectDuplicateEntryNames(entries);

  return {
    schemaVersion: RUNTIME_GRAPH_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: RUNTIME_GRAPH_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: RUNTIME_GRAPH_ANALYZER_VERSION,
      }),
    ),
    entries: stableSortEntries(entries),
    diagnostics: [...diagnostics, ...dupDiagnostics],
  };
}
