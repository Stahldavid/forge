export type CapabilityStatus =
  | "required"
  | "not-detected"
  | "unknown"
  | "forbidden";

export type CapabilityConfidence = "manual" | "rule" | "static" | "runtime";

export interface Capability<T = unknown> {
  status: CapabilityStatus;
  confidence: CapabilityConfidence;
  evidence: string[];
  value?: T;
}

export interface SecretRequirement {
  envVar: string;
  required: boolean;
  detectedFrom: "jsdoc" | "signature" | "rule" | "readme" | "recipe";
}

export interface CapabilitySet {
  network: Capability<{ egress?: string[] }>;
  filesystem: Capability<{ read?: boolean; write?: boolean }>;
  process: Capability;
  nativeAddon: Capability;
  lifecycleScripts: Capability;
  secrets: SecretRequirement[];
}
