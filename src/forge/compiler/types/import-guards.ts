import type { RuntimeContext } from "./runtime.ts";
import type { RuntimeMatrixEntry } from "./runtime-matrix.ts";

export interface ImportGuardModuleContext {
  file: string;
  effectiveContexts: RuntimeContext[];
}

export interface ImportGuardsArtifact {
  schemaVersion: string;
  entries: Array<{
    packageName: string;
    alias: string;
    compatible: RuntimeMatrixEntry["compatible"];
    incompatible: RuntimeMatrixEntry["incompatible"];
    rationale: RuntimeMatrixEntry["rationale"];
  }>;
  moduleContexts: ImportGuardModuleContext[];
}
