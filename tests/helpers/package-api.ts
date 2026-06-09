import type { PackageApi } from "../../src/forge/compiler/types/package-graph.ts";

export function makePackageApi(
  overrides: Partial<PackageApi> & Pick<PackageApi, "name">,
): PackageApi {
  return {
    version: "1.0.0",
    packageManager: "bun",
    resolutionMode: "nodenext",
    entrypoints: [],
    source: "static",
    contentChecksum: "abc123",
    ...overrides,
  };
}

export function makeExport(
  name: string,
  signature: string,
  jsdoc?: { summary: string; tags: { tag: string; text: string }[] },
) {
  return {
    name,
    kind: "function" as const,
    signature,
    classification: {
      alias: "",
      packageName: "",
      entrypoint: ".",
      exportName: name,
      compatible: [],
      incompatible: [],
      capabilities: {
        network: { status: "unknown" as const, confidence: "static" as const, evidence: [] },
        filesystem: { status: "unknown" as const, confidence: "static" as const, evidence: [] },
        process: { status: "unknown" as const, confidence: "static" as const, evidence: [] },
        nativeAddon: { status: "not-detected" as const, confidence: "static" as const, evidence: [] },
        lifecycleScripts: { status: "not-detected" as const, confidence: "rule" as const, evidence: [] },
        secrets: [],
      },
    },
    jsdoc: jsdoc ?? null,
    examples: [],
  };
}
