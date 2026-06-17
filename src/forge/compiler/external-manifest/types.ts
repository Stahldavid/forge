import type { Diagnostic } from "../types/diagnostic.ts";

export const FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION = "1.0";
export const FORGE_EXTERNAL_MANIFEST_REGISTRY = ".forge/external-manifests.json";

export type ForgeExternalManifestLanguage =
  | "go"
  | "java"
  | "kotlin"
  | "csharp"
  | "rust"
  | "python"
  | "typescript"
  | string;

export type ForgeExternalTransportKind = "http" | "grpc" | "stdio";
export type ForgeExternalEntryKind = "command" | "query";
export type ForgeExternalEntryRisk = "read" | "write" | "destructive" | "external";
export type ForgeExternalTransactionMode =
  | "read-only"
  | "external-managed"
  | "forge-managed"
  | "saga";

export interface ForgeExternalManifestService {
  name: string;
  transport: ForgeExternalTransportKind;
  baseUrl?: string;
  command?: string;
  health?: string;
}

export interface ForgeExternalManifestEntry {
  name: string;
  kind: ForgeExternalEntryKind;
  description?: string;
  path?: string;
  method?: "GET" | "POST";
  inputSchema?: unknown;
  outputSchema?: unknown;
  policy?: string;
  tenantScoped?: boolean;
  transaction?: ForgeExternalTransactionMode;
  risk?: ForgeExternalEntryRisk;
  needsApproval?: boolean;
  effects?: string[];
}

export interface ForgeExternalManifest {
  forgeProtocol: typeof FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION;
  language: ForgeExternalManifestLanguage;
  framework?: string;
  service: ForgeExternalManifestService;
  entries: ForgeExternalManifestEntry[];
  schemas?: Record<string, unknown>;
}

export interface ForgeExternalManifestRegistryFile {
  schemaVersion: "0.1.0";
  manifests: ForgeExternalManifest[];
}

export interface ForgeExternalServiceEntry extends ForgeExternalManifestEntry {
  service: string;
  language: ForgeExternalManifestLanguage;
  framework?: string;
  transport: ForgeExternalTransportKind;
  source: "external";
}

export interface ForgeExternalService {
  name: string;
  language: ForgeExternalManifestLanguage;
  framework?: string;
  transport: ForgeExternalTransportKind;
  baseUrl?: string;
  command?: string;
  health?: string;
  entries: ForgeExternalServiceEntry[];
}

export interface ForgeExternalServiceGraph {
  schemaVersion: "0.1.0";
  protocolVersion: typeof FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION;
  inputHash: string;
  registryPath: string;
  services: ForgeExternalService[];
  diagnostics: Diagnostic[];
}
