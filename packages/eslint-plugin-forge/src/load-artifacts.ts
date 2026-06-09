import { readFileSync } from "node:fs";
import { stripDeterministicHeader } from "../../../src/forge/compiler/primitives/header.ts";
import type { ImportGuardsArtifact } from "../../../src/forge/compiler/types/import-guards.ts";
import type { RuntimeMatrix } from "../../../src/forge/compiler/types/runtime-matrix.ts";

export interface ForgeGuardArtifacts {
  importGuards: ImportGuardsArtifact;
  runtimeMatrix: RuntimeMatrix;
}

function parseGeneratedJson<T>(path: string): T {
  const raw = stripDeterministicHeader(readFileSync(path, "utf8"));
  return JSON.parse(raw) as T;
}

export function loadForgeGuardArtifacts(
  importGuardsPath: string,
  runtimeMatrixPath: string,
): ForgeGuardArtifacts {
  const importGuards = parseGeneratedJson<ImportGuardsArtifact>(importGuardsPath);
  const runtimeMatrix = parseGeneratedJson<RuntimeMatrix>(runtimeMatrixPath);

  return { importGuards, runtimeMatrix };
}
