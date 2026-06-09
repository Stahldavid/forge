import { createDiagnostic } from "../diagnostics/create.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph, DataTable } from "../types/data-graph.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import {
  DATA_GRAPH_ANALYZER_VERSION,
  DATA_GRAPH_SCHEMA_VERSION,
} from "./constants.ts";
import { parseDefineTableSlice } from "./parse.ts";

function stableSortTables(tables: DataTable[]): DataTable[] {
  return [...tables].sort((a, b) => {
    if (a.name !== b.name) {
      return a.name < b.name ? -1 : 1;
    }
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return a.symbolId < b.symbolId ? -1 : a.symbolId > b.symbolId ? 1 : 0;
  });
}

function deriveTableId(symbolId: string, tableName: string): string {
  return hashStable(`${symbolId}\0${tableName}`);
}

function detectDuplicateTableNames(tables: DataTable[]): DataGraph["diagnostics"] {
  const byName = new Map<string, DataTable[]>();

  for (const table of tables) {
    const list = byName.get(table.name) ?? [];
    list.push(table);
    byName.set(table.name, list);
  }

  const diagnostics: DataGraph["diagnostics"] = [];

  for (const [name, group] of byName) {
    if (group.length <= 1) {
      continue;
    }

    for (const table of group) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DUP_TABLE",
          message: `duplicate table name '${name}'`,
          file: table.file,
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

export function buildDataGraph(appGraph: AppGraph): DataGraph {
  const tables: DataTable[] = [];
  const diagnostics: DataGraph["diagnostics"] = [];

  for (const symbol of appGraph.symbols) {
    if (symbol.kind !== "schema.table") {
      continue;
    }

    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";

    if (sourceSlice.length === 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DATA_SCHEMA_UNPARSEABLE",
          message: `cannot parse defineTable for '${symbol.qualifiedName}': missing source slice`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
      continue;
    }

    const parsed = parseDefineTableSlice(sourceSlice);
    if (!parsed || parsed.tableName === null) {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DATA_SCHEMA_UNPARSEABLE",
          message: `cannot parse defineTable for '${symbol.qualifiedName}'`,
          file: symbol.file,
          span: symbol.span,
        }),
      );
      continue;
    }

    tables.push({
      id: deriveTableId(symbol.id, parsed.tableName),
      name: parsed.tableName,
      symbolId: symbol.id,
      exportName: symbol.name,
      file: symbol.file,
      fields: parsed.fields,
    });
  }

  const dupDiagnostics = detectDuplicateTableNames(tables);

  return {
    schemaVersion: DATA_GRAPH_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: DATA_GRAPH_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: DATA_GRAPH_ANALYZER_VERSION,
      }),
    ),
    tables: stableSortTables(tables),
    diagnostics: [...diagnostics, ...dupDiagnostics],
  };
}
