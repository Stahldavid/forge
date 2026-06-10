import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_RELEASE_DIRTY_WORKTREE,
  FORGE_RELEASE_PROVIDER_CONFIG_MISSING,
  FORGE_SOURCEMAP_PUBLIC_EXPOSURE,
} from "../../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { serializeCanonical } from "../../compiler/primitives/serialize.ts";
import type {
  ArtifactManifest,
  BuildInfo,
  DeployManifest,
  ReleaseArtifact,
  ReleaseExportProvider,
  ReleaseManifest,
  SourceMapEntry,
  SourceMapManifest,
  SymbolicationManifest,
} from "../../compiler/release/types.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";

export interface RuntimeReleaseInfo {
  releaseId?: string;
  deployId?: string;
  environment?: string;
}

export function currentReleaseInfo(): RuntimeReleaseInfo {
  return {
    releaseId: process.env.FORGE_RELEASE_ID ?? process.env.NEXT_PUBLIC_FORGE_RELEASE_ID,
    deployId: process.env.FORGE_DEPLOY_ID,
    environment: process.env.FORGE_DEPLOY_ENV ?? process.env.FORGE_ENV ?? process.env.NODE_ENV,
  };
}

function packageInfo(workspaceRoot: string): { name: string; version: string } {
  const pkg = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  return { name: pkg.name ?? "forge-app", version: pkg.version ?? "0.0.0" };
}

function gitSha(workspaceRoot: string): string {
  const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() || "nogit" : "nogit";
}

function isDirty(workspaceRoot: string): boolean {
  const result = spawnSync("git", ["status", "--porcelain"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function releaseDir(workspaceRoot: string, releaseId: string): string {
  return join(workspaceRoot, ".forge", "releases", releaseId.replace(/[^\w@.+-]/g, "_"));
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    if (!existsSync(dir)) {
      return;
    }
    for (const entry of readdirSync(dir)) {
      const absolute = join(dir, entry);
      const stat = statSync(absolute);
      if (stat.isDirectory()) {
        if (entry === "node_modules" || entry === ".forge" || entry === ".git") {
          continue;
        }
        walk(absolute);
      } else if (stat.isFile()) {
        files.push(absolute);
      }
    }
  }
  walk(root);
  return files.sort();
}

function artifactKind(path: string): ReleaseArtifact["kind"] {
  if (path.endsWith(".js")) {
    return "javascript";
  }
  if (path.endsWith(".map")) {
    return "sourcemap";
  }
  if (path.endsWith(".json")) {
    return "manifest";
  }
  return "asset";
}

function isPublicArtifact(relativePath: string): boolean {
  return relativePath.startsWith("public/") ||
    relativePath.includes("/public/") ||
    relativePath.includes(".next/static/");
}

export function collectReleaseArtifacts(workspaceRoot: string, releaseId: string): {
  artifactManifest: ArtifactManifest;
  sourceMapManifest: SourceMapManifest;
  symbolicationManifest: SymbolicationManifest;
} {
  const roots = ["dist", "build", ".next", "web/.next", "public"];
  const artifacts: ReleaseArtifact[] = [];
  const sourceMaps: SourceMapEntry[] = [];
  const diagnostics: Diagnostic[] = [];

  for (const root of roots) {
    const absoluteRoot = join(workspaceRoot, root);
    for (const absolute of listFiles(absoluteRoot)) {
      const rel = relative(workspaceRoot, absolute).replace(/\\/g, "/");
      if (!rel.endsWith(".js") && !rel.endsWith(".map") && !rel.endsWith(".json")) {
        continue;
      }
      const stat = statSync(absolute);
      const artifact: ReleaseArtifact = {
        path: rel,
        kind: artifactKind(rel),
        public: isPublicArtifact(rel),
        sizeBytes: stat.size,
        sha256: sha256(absolute),
      };
      if (rel.endsWith(".js") && existsSync(join(workspaceRoot, `${rel}.map`))) {
        artifact.sourceMap = `${rel}.map`;
      }
      artifacts.push(artifact);
      if (rel.endsWith(".map")) {
        if (artifact.public) {
          diagnostics.push(
            createDiagnostic({
              severity: "warning",
              code: FORGE_SOURCEMAP_PUBLIC_EXPOSURE,
              message: `public source map detected: ${rel}`,
              file: rel,
            }),
          );
        }
        try {
          const map = JSON.parse(readFileSync(absolute, "utf8")) as {
            file?: string;
            sources?: string[];
            debug_id?: string;
            debugId?: string;
          };
          sourceMaps.push({
            generatedFile: map.file ?? rel.replace(/\.map$/, ""),
            sourceMapFile: rel,
            sources: [...(map.sources ?? [])].sort(),
            public: artifact.public,
            ...(map.debug_id || map.debugId ? { debugId: map.debug_id ?? map.debugId } : {}),
          });
        } catch {
          // Keep the artifact entry even when the source map body is invalid.
        }
      }
    }
  }

  const artifactManifest: ArtifactManifest = {
    schemaVersion: "0.1.0",
    releaseId,
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
    diagnostics,
  };
  const sourceMapManifest: SourceMapManifest = {
    schemaVersion: "0.1.0",
    releaseId,
    sourceMaps: sourceMaps.sort((a, b) => a.sourceMapFile.localeCompare(b.sourceMapFile)),
    diagnostics,
  };
  return {
    artifactManifest,
    sourceMapManifest,
    symbolicationManifest: {
      schemaVersion: "0.1.0",
      releaseId,
      localSymbolication: true,
      sourceMapCount: sourceMaps.length,
      providers: ["local", "sentry-compatible", "sentry", "glitchtip", "bugsink", "otel", "custom"],
      diagnostics,
    },
  };
}

export function prepareRelease(options: {
  workspaceRoot: string;
  env: string;
  allowDirty: boolean;
}): {
  ok: boolean;
  releaseId: string;
  releaseDir: string;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  if (options.env === "production" && !options.allowDirty && isDirty(options.workspaceRoot)) {
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: FORGE_RELEASE_DIRTY_WORKTREE,
        message: "production release requires a clean git worktree or --allow-dirty",
      }),
    );
  }

  const pkg = packageInfo(options.workspaceRoot);
  const sha = gitSha(options.workspaceRoot);
  const releaseId = `${pkg.name}@${pkg.version}+${sha}`;
  const deployId = `${options.env}-${releaseId}`;
  const dir = releaseDir(options.workspaceRoot, releaseId);
  mkdirSync(dir, { recursive: true });

  const collected = collectReleaseArtifacts(options.workspaceRoot, releaseId);
  const releaseManifest: ReleaseManifest = {
    schemaVersion: "0.1.0",
    releaseId,
    packageName: pkg.name,
    packageVersion: pkg.version,
    gitSha: sha,
    defaultProvider: "local",
    optionalProviders: ["local", "sentry-compatible", "sentry", "glitchtip", "bugsink", "otel", "custom"],
    env: {
      releaseId: "FORGE_RELEASE_ID",
      deployId: "FORGE_DEPLOY_ID",
      deployEnv: "FORGE_DEPLOY_ENV",
      publicReleaseId: "NEXT_PUBLIC_FORGE_RELEASE_ID",
    },
    diagnostics,
  };
  const deployManifest: DeployManifest = {
    schemaVersion: "0.1.0",
    deployId,
    releaseId,
    environment: options.env,
    attributes: {
      "service.version": releaseId,
      "deployment.environment": options.env,
      "forge.release_id": releaseId,
      "forge.deploy_id": deployId,
    },
  };
  const buildInfo: BuildInfo = {
    schemaVersion: "0.1.0",
    packageName: pkg.name,
    packageVersion: pkg.version,
    gitSha: sha,
    releaseId,
    generatedHash: sha256(join(options.workspaceRoot, "forge.lock")),
  };

  const files: Array<[string, unknown]> = [
    ["release.json", releaseManifest],
    [`deploy.${options.env}.json`, deployManifest],
    ["artifacts.json", collected.artifactManifest],
    ["sourcemaps.json", collected.sourceMapManifest],
    ["symbolication.json", collected.symbolicationManifest],
    ["graph-hashes.json", {
      appGraph: fileHash(options.workspaceRoot, `${GENERATED_DIR}/appGraph.json`),
      packageGraph: fileHash(options.workspaceRoot, `${GENERATED_DIR}/packageGraph.json`),
      runtimeGraph: fileHash(options.workspaceRoot, `${GENERATED_DIR}/runtimeGraph.json`),
      dataGraph: fileHash(options.workspaceRoot, `${GENERATED_DIR}/dataGraph.json`),
      policyRegistry: fileHash(options.workspaceRoot, `${GENERATED_DIR}/policyRegistry.json`),
    }],
    ["telemetry-correlation.json", {
      releaseId,
      deployId,
      environment: options.env,
      attributes: deployManifest.attributes,
    }],
    ["build-info.json", buildInfo],
  ];
  for (const [name, value] of files) {
    writeFileSync(join(dir, name), serializeCanonical(value), "utf8");
  }

  return {
    ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    releaseId,
    releaseDir: dir.replace(/\\/g, "/"),
    diagnostics: [...diagnostics, ...collected.artifactManifest.diagnostics],
  };
}

function fileHash(workspaceRoot: string, relativePath: string): string | null {
  const absolute = join(workspaceRoot, relativePath);
  return existsSync(absolute) ? sha256(absolute) : null;
}

export function providerConfigDiagnostics(provider: ReleaseExportProvider): Diagnostic[] {
  if (provider === "local" || provider === "otel") {
    return [];
  }
  const sentryCompatible =
    process.env.FORGE_ERROR_TRACKING_DSN ||
    (provider === "sentry" ? process.env.SENTRY_DSN : undefined);
  if (sentryCompatible) {
    return [];
  }
  return [
    createDiagnostic({
      severity: "error",
      code: FORGE_RELEASE_PROVIDER_CONFIG_MISSING,
      message: `release provider '${provider}' requires explicit DSN/config; no upload was attempted`,
    }),
  ];
}
