import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import type { GeneratedReleaseArtifacts, ReleaseExportProvider } from "./types.ts";

function readPackageInfo(workspaceRoot: string): { name: string; version: string } {
  const path = join(workspaceRoot, "package.json");
  if (!nodeFileSystem.exists(path)) {
    return { name: "forge-app", version: "0.0.0" };
  }
  const pkg = JSON.parse((nodeFileSystem.readText(path) ?? "")) as {
    name?: string;
    version?: string;
  };
  return {
    name: pkg.name ?? "forge-app",
    version: pkg.version ?? "0.0.0",
  };
}

export function buildGeneratedReleaseArtifacts(input: {
  workspaceRoot: string;
  generatedHash: string;
}): GeneratedReleaseArtifacts {
  const project = readPackageInfo(input.workspaceRoot);
  const gitSha = "unknown";
  const releaseId = `${project.name}@${project.version}+${gitSha}`;
  const deployId = `local-${releaseId}`;
  const optionalProviders: ReleaseExportProvider[] = [
    "local",
    "sentry-compatible",
    "sentry",
    "glitchtip",
    "bugsink",
    "otel",
    "custom",
  ];

  const releaseManifest = {
    schemaVersion: "0.1.0" as const,
    releaseId,
    packageName: project.name,
    packageVersion: project.version,
    gitSha,
    defaultProvider: "local" as const,
    optionalProviders,
    env: {
      releaseId: "FORGE_RELEASE_ID" as const,
      deployId: "FORGE_DEPLOY_ID" as const,
      deployEnv: "FORGE_DEPLOY_ENV" as const,
      publicReleaseId: "NEXT_PUBLIC_FORGE_RELEASE_ID" as const,
    },
    diagnostics: [],
  };

  return {
    releaseManifest,
    deployManifest: {
      schemaVersion: "0.1.0",
      deployId,
      releaseId,
      environment: "local",
      attributes: {
        "service.version": releaseId,
        "deployment.environment": "local",
        "forge.release_id": releaseId,
        "forge.deploy_id": deployId,
        "forge.generated_hash": input.generatedHash,
      },
    },
    artifactManifest: {
      schemaVersion: "0.1.0",
      releaseId,
      artifacts: [],
      diagnostics: [],
    },
    sourceMapManifest: {
      schemaVersion: "0.1.0",
      releaseId,
      sourceMaps: [],
      diagnostics: [],
    },
    symbolicationManifest: {
      schemaVersion: "0.1.0",
      releaseId,
      localSymbolication: true,
      sourceMapCount: 0,
      providers: releaseManifest.optionalProviders,
      diagnostics: [],
    },
    buildInfo: {
      schemaVersion: "0.1.0",
      packageName: project.name,
      packageVersion: project.version,
      gitSha,
      releaseId,
      generatedHash: input.generatedHash || GENERATOR_VERSION,
    },
  };
}
