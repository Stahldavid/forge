export type { RuntimeClassifier } from "./classify.ts";
export { classify, createRuntimeClassifier } from "./classify.ts";
export { detectCapabilities } from "./capabilities.ts";
export { detectSecrets } from "./secrets.ts";
export {
  evaluateContext,
  hasUnknownCapability,
  hasNetworkEgress,
  partitionContexts,
} from "./contexts.ts";
export type { ContextVerdict } from "./contexts.ts";
export { gatherSignals } from "./signals.ts";
export type { PackageSignals } from "./signals.ts";
export {
  buildRuntimeMatrix,
  lookupMatrixEntry,
} from "./runtime-matrix.ts";
export type { ClassifiedPackage } from "./runtime-matrix.ts";
