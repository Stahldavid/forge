import type {
  Capability,
  CapabilitySet,
  SecretRequirement,
} from "../types/capability.ts";

export function capability<T = unknown>(
  status: Capability["status"],
  confidence: Capability["confidence"],
  evidence: string[],
  value?: T,
): Capability<T> {
  const cap: Capability<T> = { status, confidence, evidence };
  if (value !== undefined) {
    cap.value = value;
  }
  return cap;
}

export function emptyCapabilitySet(): CapabilitySet {
  return {
    network: capability("not-detected", "rule", ["default: no network signals"]),
    filesystem: capability("not-detected", "rule", ["default: no filesystem signals"]),
    process: capability("not-detected", "rule", ["default: no process signals"]),
    nativeAddon: capability("not-detected", "rule", ["default: no native addon signals"]),
    lifecycleScripts: capability("not-detected", "rule", ["default: scripts disabled by forge add"]),
    secrets: [],
  };
}

export function secret(
  envVar: string,
  required = true,
  detectedFrom: SecretRequirement["detectedFrom"] = "recipe",
): SecretRequirement {
  return { envVar, required, detectedFrom };
}
