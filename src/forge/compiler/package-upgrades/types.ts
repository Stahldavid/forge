import type { Diagnostic } from "../types/diagnostic.ts";
import type { PackageManager, RuntimeContext } from "../types/runtime.ts";

export type UpgradeTarget =
  | { kind: "version"; version: string }
  | { kind: "dist-tag"; tag: string }
  | { kind: "semver-bump"; bump: "patch" | "minor" | "major" }
  | { kind: "range"; range: string }
  | { kind: "wanted" };

export interface PackageVersionInfo {
  version: string;
  spec: string;
  distTag?: string;
  integrity?: string;
  tarballUrl?: string;
  publishedAt?: string;
}

export interface ExportChange {
  entrypoint: string;
  exportName: string;
  kind: string;
}

export interface CallsiteImpact {
  file: string;
  symbolName?: string;
  symbolKind?: string;
}

export interface SignatureChange {
  entrypoint: string;
  exportName: string;
  before: string;
  after: string;
  affectedCallsites: CallsiteImpact[];
}

export interface EntrypointChange {
  entrypoint: string;
  kind: "added" | "removed" | "changed";
}

export interface PackageApiDiff {
  removedExports: ExportChange[];
  addedExports: ExportChange[];
  changedSignatures: SignatureChange[];
  changedEntrypoints: EntrypointChange[];
  changedJSDoc: unknown[];
  typeResolutionChanges: unknown[];
}

export interface CapabilityChange {
  name: string;
  before?: string;
  after?: string;
}

export interface RuntimeDiff {
  capabilitiesChanged: boolean;
  addedCapabilities: CapabilityChange[];
  removedCapabilities: CapabilityChange[];
  contextCompatibilityChanged: boolean;
  contextsNowDenied: RuntimeContext[];
  contextsNowAllowed: RuntimeContext[];
  secretChanges: {
    added: string[];
    removed: string[];
    changedRequired: string[];
  };
  recipeChanged: boolean;
  previousRecipeVersion?: string;
  nextRecipeVersion?: string;
}

export interface UpgradeImportImpact {
  file: string;
  specifier: string;
  importKind: "static" | "dynamic" | "require" | "type";
}

export interface UpgradeImpact {
  files: string[];
  imports: UpgradeImportImpact[];
  commands: string[];
  queries: string[];
  liveQueries: string[];
  actions: string[];
  workflows: string[];
  workflowSteps: string[];
  endpoints: string[];
  frontendComponents: string[];
  generatedAdapters: string[];
  tests: string[];
}

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskReason {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface RiskBlocker {
  code: string;
  message: string;
  recommendedAction: string;
}

export interface UpgradeRiskReport {
  level: RiskLevel;
  score: number;
  reasons: RiskReason[];
  blockers: RiskBlocker[];
}

export interface SecurityDiff {
  enabled: boolean;
  fixed: string[];
  introduced: string[];
  diagnostics: Diagnostic[];
}

export interface GeneratedChange {
  file: string;
  reason: string;
}

export interface UpgradeTestPlan {
  commands: string[];
  tests: string[];
  manualChecks: string[];
}

export interface RollbackPlan {
  id: string;
  snapshotDir: string;
  files: string[];
  reinstallCommand: string;
}

export interface PackageUpgradePlan {
  schemaVersion: "0.1.0";
  plannerVersion: string;
  id: string;
  packageName: string;
  requestedPackageName?: string;
  dependencyAlias?: string;
  integrationAlias?: string;
  from: PackageVersionInfo;
  to: PackageVersionInfo;
  packageManager: PackageManager;
  semver: {
    bump: "patch" | "minor" | "major" | "prerelease" | "unknown";
    rangeChangeRequired: boolean;
  };
  apiDiff: PackageApiDiff;
  runtimeDiff: RuntimeDiff;
  affected: UpgradeImpact;
  risk: UpgradeRiskReport;
  security?: SecurityDiff;
  generatedChanges: GeneratedChange[];
  recommendedCommands: string[];
  testPlan: UpgradeTestPlan;
  rollback: RollbackPlan;
  diagnostics: Diagnostic[];
}

export interface PackageUpgradeRegistry {
  schemaVersion: "0.1.0";
  plannerVersion: string;
  commands: string[];
  planDirectory: ".forge/upgrades";
}
