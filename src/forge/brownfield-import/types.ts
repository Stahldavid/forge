export type BrownfieldImportSubcommand = "analyze" | "inspect";

export interface BrownfieldImportCommandOptions {
  subcommand: BrownfieldImportSubcommand;
  json: boolean;
  dryRun: boolean;
  workspaceRoot: string;
  entry?: string;
  target?: string;
}

export type ImportedAssurance = "static-scan";
export type ImportedReviewStatus = "needs-review" | "approved" | "rejected";
export type ImportedEntryKind = "command" | "command-candidate" | "query" | "unknown";
export type ImportedRouteSource = "next-app-router" | "next-pages-api" | "express" | "nest" | "unknown";

export interface ImportedDependencyInventory {
  dependencies: string[];
  devDependencies: string[];
  scripts: string[];
  frameworks: string[];
  dataPackages: string[];
  externalPackages: string[];
}

export interface ImportedInventory {
  schemaVersion: "0.1.0";
  origin: "imported";
  assurance: ImportedAssurance;
  workspaceRoot: string;
  generatedAt: string;
  packageName?: string;
  dependencies: ImportedDependencyInventory;
  filesScanned: number;
  sourceFiles: string[];
  env: {
    processEnv: string[];
    envFiles: string[];
  };
}

export interface ImportedRoute {
  id: string;
  method: string;
  path: string;
  file: string;
  source: ImportedRouteSource;
  handler?: string;
  confidence: number;
}

export interface ImportedFrontendCall {
  id: string;
  file: string;
  client: "fetch" | "axios";
  method: string;
  url: string;
  routeId?: string;
  confidence: number;
}

export interface ImportedCandidateEntry {
  id: string;
  name: string;
  kind: ImportedEntryKind;
  method: string;
  path: string;
  routeId: string;
  file: string;
  origin: "imported";
  assurance: ImportedAssurance;
  reviewStatus: ImportedReviewStatus;
  visibleToAgent: boolean;
  needsApproval: boolean;
  confidence: number;
  risks: string[];
  evidence: string[];
}

export interface ImportedRiskFinding {
  code: string;
  severity: "info" | "warning" | "error";
  file?: string;
  routeId?: string;
  message: string;
}

export interface ImportedRiskReport {
  schemaVersion: "0.1.0";
  summary: {
    routeCount: number;
    frontendCallCount: number;
    candidateCount: number;
    commandCount: number;
    queryCount: number;
    hiddenFromAgents: number;
    needsApproval: number;
  };
  findings: ImportedRiskFinding[];
}

export interface BrownfieldImportArtifacts {
  inventory: string;
  routes: string;
  frontendCalls: string;
  candidateEntries: string;
  riskReport: string;
  migrationPlan: string;
  importedAgentContract: string;
}

export interface BrownfieldImportResult {
  schemaVersion: "0.1.0";
  feature: "H49";
  subcommand: BrownfieldImportSubcommand;
  workspaceRoot: string;
  wroteArtifacts: boolean;
  artifacts: BrownfieldImportArtifacts;
  inventory: ImportedInventory | null;
  routes: ImportedRoute[];
  frontendCalls: ImportedFrontendCall[];
  candidateEntries: ImportedCandidateEntry[];
  riskReport: ImportedRiskReport | null;
  migrationPlan: string | null;
  exitCode: 0 | 1;
  failureKind?: string;
}
