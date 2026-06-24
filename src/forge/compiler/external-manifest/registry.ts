import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createDiagnostic } from "../diagnostics/create.ts";
import { hashStable } from "../primitives/hash.ts";
import { serializeCanonical } from "../primitives/serialize.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import {
  FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION,
  FORGE_EXTERNAL_MANIFEST_REGISTRY,
  type ForgeExternalManifest,
  type ForgeExternalManifestRegistryFile,
  type ForgeExternalService,
  type ForgeExternalServiceEntry,
  type ForgeExternalServiceGraph,
} from "./types.ts";
import {
  validateExternalManifest,
  validateExternalManifestRegistry,
} from "./validate.ts";

function parseJsonFile(path: string): { value: unknown | null; diagnostics: Diagnostic[] } {
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")), diagnostics: [] };
  } catch (error) {
    return {
      value: null,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_EXTERNAL_MANIFEST_PARSE",
          message: `failed to parse external manifest JSON: ${error instanceof Error ? error.message : String(error)}`,
          file: path,
          docs: ["docs/forge-protocol.md", "schemas/forge-manifest.schema.json"],
        }),
      ],
    };
  }
}

function registryPath(workspaceRoot: string): string {
  return join(workspaceRoot, FORGE_EXTERNAL_MANIFEST_REGISTRY);
}

function rootManifestPath(workspaceRoot: string): string {
  return join(workspaceRoot, "forge.manifest.json");
}

function normalizeManifests(manifests: ForgeExternalManifest[]): ForgeExternalManifest[] {
  return [...manifests].sort((a, b) => a.service.name.localeCompare(b.service.name));
}

function serviceFromManifest(manifest: ForgeExternalManifest): ForgeExternalService {
  const entries: ForgeExternalServiceEntry[] = manifest.entries.map((entry) => ({
    ...entry,
    service: manifest.service.name,
    language: manifest.language,
    ...(manifest.framework ? { framework: manifest.framework } : {}),
    transport: manifest.service.transport,
    source: "external",
  }));
  return {
    name: manifest.service.name,
    language: manifest.language,
    ...(manifest.framework ? { framework: manifest.framework } : {}),
    transport: manifest.service.transport,
    ...(manifest.service.baseUrl ? { baseUrl: manifest.service.baseUrl } : {}),
    ...(manifest.service.command ? { command: manifest.service.command } : {}),
    ...(manifest.service.commandArgs ? { commandArgs: manifest.service.commandArgs } : {}),
    ...(manifest.service.health ? { health: manifest.service.health } : {}),
    entries,
  };
}

function duplicateServiceDiagnostics(
  manifests: ForgeExternalManifest[],
  file: string,
): Diagnostic[] {
  const seen = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const manifest of manifests) {
    if (seen.has(manifest.service.name)) {
      diagnostics.push(createDiagnostic({
        severity: "error",
        code: "FORGE_EXTERNAL_SERVICE_DUPLICATE",
        message: `external service '${manifest.service.name}' is imported more than once`,
        file,
        fixHint: "Keep one manifest per external service name in .forge/external-manifests.json.",
        docs: ["docs/forge-protocol.md"],
      }));
    }
    seen.add(manifest.service.name);
  }
  return diagnostics;
}

export function readExternalManifestFile(path: string): {
  manifest: ForgeExternalManifest | null;
  diagnostics: Diagnostic[];
} {
  const parsed = parseJsonFile(path);
  if (parsed.value === null) {
    return { manifest: null, diagnostics: parsed.diagnostics };
  }
  const result = validateExternalManifest(parsed.value, { file: path });
  return { manifest: result.manifest, diagnostics: [...parsed.diagnostics, ...result.diagnostics] };
}

export function loadExternalManifestRegistry(
  workspaceRoot: string,
): { registry: ForgeExternalManifestRegistryFile; diagnostics: Diagnostic[]; path: string } {
  const path = registryPath(workspaceRoot);
  const diagnostics: Diagnostic[] = [];
  const manifests: ForgeExternalManifest[] = [];

  if (existsSync(path)) {
    const parsed = parseJsonFile(path);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.value !== null) {
      const result = validateExternalManifestRegistry(parsed.value, { file: path });
      diagnostics.push(...result.diagnostics);
      if (result.registry) {
        manifests.push(...result.registry.manifests);
      }
    }
  }

  const rootPath = rootManifestPath(workspaceRoot);
  if (existsSync(rootPath)) {
    const result = readExternalManifestFile(rootPath);
    diagnostics.push(...result.diagnostics);
    if (result.manifest) {
      manifests.push(result.manifest);
    }
  }

  diagnostics.push(...duplicateServiceDiagnostics(manifests, path));
  return {
    path,
    registry: {
      schemaVersion: "0.1.0",
      manifests: normalizeManifests(manifests),
    },
    diagnostics,
  };
}

export function buildExternalServiceGraph(workspaceRoot: string): ForgeExternalServiceGraph {
  const loaded = loadExternalManifestRegistry(workspaceRoot);
  const services = loaded.registry.manifests.map(serviceFromManifest);
  return {
    schemaVersion: "0.1.0",
    protocolVersion: FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION,
    registryPath: FORGE_EXTERNAL_MANIFEST_REGISTRY,
    inputHash: hashStable(serializeCanonical({ services, diagnostics: loaded.diagnostics })),
    services,
    diagnostics: loaded.diagnostics,
  };
}

export function importExternalManifest(
  workspaceRoot: string,
  inputPath: string,
): { graph: ForgeExternalServiceGraph; diagnostics: Diagnostic[]; imported: boolean; path: string } {
  const absoluteInput = resolve(workspaceRoot, inputPath);
  const result = readExternalManifestFile(absoluteInput);
  if (!result.manifest || result.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return {
      graph: buildExternalServiceGraph(workspaceRoot),
      diagnostics: result.diagnostics,
      imported: false,
      path: absoluteInput,
    };
  }

  const loaded = loadExternalManifestRegistry(workspaceRoot);
  const remaining = loaded.registry.manifests.filter(
    (manifest) => manifest.service.name !== result.manifest?.service.name,
  );
  const registry: ForgeExternalManifestRegistryFile = {
    schemaVersion: "0.1.0",
    manifests: normalizeManifests([...remaining, result.manifest]),
  };
  const path = registryPath(workspaceRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${serializeCanonical(registry).trimEnd()}\n`, "utf8");
  const graph = buildExternalServiceGraph(workspaceRoot);
  return {
    graph,
    diagnostics: [...loaded.diagnostics, ...result.diagnostics],
    imported: true,
    path,
  };
}

export function serializeExternalServiceGraphJson(graph: ForgeExternalServiceGraph): string {
  return serializeCanonical(graph);
}

export function serializeExternalServiceGraphTs(graph: ForgeExternalServiceGraph): string {
  return `export const externalServices = ${JSON.stringify(
    JSON.parse(serializeExternalServiceGraphJson(graph)),
    null,
    2,
  )} as const;\n`;
}
