/** Shared public capability boundary; reports support, not real-provider certification. */
export const programWorkflowExtensions = Object.freeze({
  authoring: { templates: ["review", "bugfix", "migration"], ownerValidated: true, typedRegistry: true, dispatch: false },
  runtimeConfig: ".forge/fabric-runtime.json",
  scheduler: { fairness: "round-robin", defaultOwnerCapacity: 4, maxOwnerCapacity: 32 },
  resources: { enforcement: "admission-only", unknownUsageExplicit: true, providerHardCap: false },
  observations: { durable: true, deduplicated: true, invalidOutputRetainsUsage: true },
  executors: ["codex", "command", "claude"],
  claude: { optIn: true, isolation: "cooperative", network: "host", realProviderVerified: false },
  nativeImages: ["codex"],
  threadRecovery: "codex-observed-compatible-original-workspace",
  conflictResolution: "owner-registered-resolver-fresh-final-assessment",
  externalQualityEvaluated: false,
});
