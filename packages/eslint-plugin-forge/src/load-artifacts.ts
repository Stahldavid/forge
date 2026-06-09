import { readFileSync } from "node:fs";
import type { ImportGuardsArtifact } from "../../../src/forge/compiler/types/import-guards.ts";
import type { RuntimeMatrix } from "../../../src/forge/compiler/types/runtime-matrix.ts";

export interface ForgeGuardArtifacts {
  importGuards: ImportGuardsArtifact;
  runtimeMatrix: RuntimeMatrix;
}

export function loadForgeGuardArtifacts(
  importGuardsPath: string,
  runtimeMatrixPath: string,
): ForgeGuardArtifacts {
  const importGuards = JSON.parse(
    readFileSync(importGuardsPath, "utf8"),
  ) as ImportGuardsArtifact;
  const runtimeMatrix = JSON.parse(
    readFileSync(runtimeMatrixPath, "utf8"),
  ) as RuntimeMatrix;

  return { importGuards, runtimeMatrix };
}
