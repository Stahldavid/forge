import type { ExportClassification } from "./package-graph.ts";
import type { RuntimeContext } from "./runtime.ts";

export interface RuntimeClassification {
  compatible: RuntimeContext[];
  incompatible: RuntimeContext[];
  rationale: Record<RuntimeContext, string>;
  perEntrypoint: ExportClassification[];
}
