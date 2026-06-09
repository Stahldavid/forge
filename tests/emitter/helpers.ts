import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { EmitPlan } from "../../src/forge/compiler/types/emit.ts";
import type { ForgeLock } from "../../src/forge/compiler/types/lock.ts";
import { emptyCapabilitySet } from "../../src/forge/compiler/recipes/helpers.ts";
import {
  FORGE_LOCK_SCHEMA_VERSION,
  GENERATED_DIR,
  GENERATOR_VERSION,
} from "../../src/forge/compiler/emitter/constants.ts";
import {
  hashStable,
  serializeCanonical,
} from "../../src/forge/compiler/primitives/index.ts";
import { PACKAGE_ANALYZER_VERSION } from "../../src/forge/compiler/package-graph/constants.ts";

export function tempWorkspace(prefix: string): string {
  const dir = join(import.meta.dir, ".tmp", `${prefix}-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function makeSampleLock(overrides: Partial<ForgeLock> = {}): ForgeLock {
  return {
    schemaVersion: FORGE_LOCK_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: PACKAGE_ANALYZER_VERSION,
    inputHash: "sample-input-hash",
    lockfileHash: "sample-lockfile-hash",
    packageManager: "bun",
    recipeVersion: "1",
    packages: [
      {
        name: "zod",
        version: "3.24.1",
        recipeVersion: "1",
        runtimeContexts: ["shared", "server"],
        capabilities: emptyCapabilitySet(),
        secrets: [],
        generatedFiles: [`${GENERATED_DIR}/packages/zod.shared.ts`],
        contentChecksum: "zod-checksum",
      },
    ],
    ...overrides,
  };
}

export function makeSampleEmitPlan(lock = makeSampleLock()): EmitPlan {
  const appGraphTsBody = "export const appGraph = { symbols: [], edges: [] } as const;\n";
  const appGraphJsonBody = serializeCanonical({
    schemaVersion: "1.0.0",
    symbols: [],
    edges: [],
  });
  const packageGraphTsBody =
    "export const packageGraph = { packages: [] } as const;\n";
  const packageGraphJsonBody = serializeCanonical({
    schemaVersion: "1.0.0",
    packages: [],
  });

  return {
    files: [
      {
        path: `${GENERATED_DIR}/appGraph.ts`,
        content: appGraphTsBody,
        contentHash: hashStable(appGraphTsBody),
      },
      {
        path: `${GENERATED_DIR}/appGraph.json`,
        content: appGraphJsonBody,
        contentHash: hashStable(appGraphJsonBody),
      },
      {
        path: `${GENERATED_DIR}/packageGraph.ts`,
        content: packageGraphTsBody,
        contentHash: hashStable(packageGraphTsBody),
      },
      {
        path: `${GENERATED_DIR}/packageGraph.json`,
        content: packageGraphJsonBody,
        contentHash: hashStable(packageGraphJsonBody),
      },
    ],
    orphanedFiles: [],
    lock,
  };
}
