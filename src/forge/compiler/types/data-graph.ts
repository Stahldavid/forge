import type { Diagnostic } from "./diagnostic.ts";

export interface DataField {
  name: string;
  type: string;
}

export interface DataTable {
  id: string;
  name: string;
  symbolId: string;
  exportName: string;
  file: string;
  fields: DataField[];
}

export interface DataGraph {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  tables: DataTable[];
  diagnostics: Diagnostic[];
}
