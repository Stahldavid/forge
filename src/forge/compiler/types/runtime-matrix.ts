import type { ExportClassification } from "./package-graph.ts";
import type { RuntimeContext } from "./runtime.ts";

export interface RuntimeMatrixEntry {
  alias: string;
  packageName: string;
  compatible: RuntimeContext[];
  incompatible: RuntimeContext[];
  rationale: Record<RuntimeContext, string>;
  perEntrypoint: ExportClassification[];
}

export interface RuntimeMatrix {
  schemaVersion: string;
  entries: RuntimeMatrixEntry[];
}
