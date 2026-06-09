import type { CapabilitySet } from "../types/capability.ts";
import type { ExportClassification } from "../types/package-graph.ts";

export function emptyCapabilitySet(): CapabilitySet {
  return {
    network: { status: "unknown", confidence: "static", evidence: [] },
    filesystem: { status: "unknown", confidence: "static", evidence: [] },
    process: { status: "unknown", confidence: "static", evidence: [] },
    nativeAddon: { status: "not-detected", confidence: "static", evidence: [] },
    lifecycleScripts: {
      status: "not-detected",
      confidence: "static",
      evidence: [],
    },
    secrets: [],
  };
}

export function stubExportClassification(
  packageName: string,
  entrypoint: string,
  exportName: string,
): ExportClassification {
  return {
    alias: packageName,
    packageName,
    entrypoint,
    exportName,
    compatible: [],
    incompatible: [],
    capabilities: emptyCapabilitySet(),
  };
}
