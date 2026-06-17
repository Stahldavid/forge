import type { CapabilitySet } from "../types/capability.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { PackageApi } from "../types/package-graph.ts";
import { capability, emptyCapabilitySet } from "../recipes/helpers.ts";
import { gatherSignals, type PackageSignals } from "./signals.ts";

export function detectCapabilities(
  api: PackageApi,
  recipe?: IntegrationRecipe,
  precomputedSignals?: PackageSignals,
): CapabilitySet {
  if (recipe) {
    return cloneCapabilitySet(recipe.capabilities);
  }

  const signals = precomputedSignals ?? gatherSignals(api);
  const caps = emptyCapabilitySet();

  if (signals.usesNetwork) {
    caps.network = capability<{ egress?: string[] }>(
      "required",
      "static",
      signals.networkEvidence,
    );
  } else {
    caps.network = capability<{ egress?: string[] }>("unknown", "static", [
      "static analysis cannot prove absence of network access",
    ]);
  }

  if (signals.usesFilesystem) {
    caps.filesystem = capability<{ read?: boolean; write?: boolean }>(
      "required",
      "static",
      signals.filesystemEvidence,
      {
        read: true,
        write: signals.filesystemEvidence.some((e) => /write/i.test(e)),
      },
    );
  } else {
    caps.filesystem = capability<{ read?: boolean; write?: boolean }>(
      "unknown",
      "static",
      ["static analysis cannot prove absence of filesystem access"],
    );
  }

  if (signals.usesProcess) {
    caps.process = capability("required", "static", signals.processEvidence);
  } else {
    caps.process = capability("unknown", "static", [
      "static analysis cannot prove absence of process access",
    ]);
  }

  if (signals.usesNativeAddon) {
    caps.nativeAddon = capability("required", "static", signals.nativeAddonEvidence);
  } else {
    caps.nativeAddon = capability("not-detected", "static", ["no native addon signals"]);
  }

  caps.lifecycleScripts = capability("not-detected", "rule", [
    "forge add disables lifecycle scripts by default",
  ]);

  return caps;
}

function cloneCapabilitySet(source: CapabilitySet): CapabilitySet {
  return {
    network: { ...source.network },
    filesystem: { ...source.filesystem },
    process: { ...source.process },
    nativeAddon: { ...source.nativeAddon },
    lifecycleScripts: { ...source.lifecycleScripts },
    secrets: [...source.secrets],
  };
}
