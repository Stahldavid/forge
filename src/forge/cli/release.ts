import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_RELEASE_ARTIFACT_MISSING,
  FORGE_RELEASE_ID_MISSING,
  FORGE_SOURCEMAP_UPLOAD_MISSING,
} from "../compiler/diagnostics/codes.ts";
import type {
  ReleaseExportProvider,
  SourceMapManifest,
  StacktraceInput,
} from "../compiler/release/types.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import {
  collectReleaseArtifacts,
  prepareRelease,
  providerConfigDiagnostics,
} from "../runtime/release/runtime.ts";
import { symbolicateStacktrace } from "../runtime/release/symbolicate.ts";

export type ReleaseArea = "release" | "artifacts" | "sourcemaps";
export type ReleaseAction =
  | "prepare"
  | "inspect"
  | "check"
  | "finalize"
  | "collect"
  | "list"
  | "verify"
  | "export"
  | "symbolicate"
  | "upload";

export interface ReleaseCommandOptions {
  area: ReleaseArea;
  action: ReleaseAction;
  workspaceRoot: string;
  json: boolean;
  env: string;
  releaseId?: string;
  input?: string;
  provider?: ReleaseExportProvider;
  target?: ReleaseExportProvider;
  allowDirty: boolean;
  allowPublicSourcemaps: boolean;
}

export interface ReleaseCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function releaseDir(workspaceRoot: string, releaseId: string): string {
  return join(workspaceRoot, ".forge", "releases", releaseId.replace(/[^\w@.+-]/g, "_"));
}

function latestReleaseDir(workspaceRoot: string): string | null {
  const root = join(workspaceRoot, ".forge", "releases");
  if (!nodeFileSystem.exists(root)) {
    return null;
  }
  const entries = Array.from(new Bun.Glob("*").scanSync({ cwd: root, onlyFiles: false }))
    .sort()
    .at(-1);
  return entries ? join(root, entries) : null;
}

function readJson<T>(path: string): T | null {
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  return JSON.parse((nodeFileSystem.readText(path) ?? "")) as T;
}

function sourceMapManifestFor(options: ReleaseCommandOptions): SourceMapManifest | null {
  const dir = options.releaseId
    ? releaseDir(options.workspaceRoot, options.releaseId)
    : latestReleaseDir(options.workspaceRoot);
  if (dir) {
    const manifest = readJson<SourceMapManifest>(join(dir, "sourcemaps.json"));
    if (manifest) {
      return manifest;
    }
  }
  return readJson<SourceMapManifest>(
    join(options.workspaceRoot, "src", "forge", "_generated", "sourceMapManifest.json"),
  );
}

export async function runReleaseCommand(
  options: ReleaseCommandOptions,
): Promise<ReleaseCommandResult> {
  if (options.area === "release" && options.action === "prepare") {
    const prepared = prepareRelease({
      workspaceRoot: options.workspaceRoot,
      env: options.env,
      allowDirty: options.allowDirty,
    });
    return {
      ok: prepared.ok,
      data: { releaseId: prepared.releaseId, releaseDir: prepared.releaseDir },
      diagnostics: prepared.diagnostics,
      exitCode: prepared.ok ? 0 : 1,
    };
  }

  if (options.area === "release" && options.action === "inspect") {
    const dir = options.releaseId
      ? releaseDir(options.workspaceRoot, options.releaseId)
      : latestReleaseDir(options.workspaceRoot);
    if (!dir) {
      return missingRelease();
    }
    const release = readJson(join(dir, "release.json"));
    return release
      ? { ok: true, data: release, diagnostics: [], exitCode: 0 }
      : missingRelease();
  }

  if (options.area === "release" && (options.action === "check" || options.action === "finalize")) {
    const dir = latestReleaseDir(options.workspaceRoot);
    const diagnostics: Diagnostic[] = [];
    if (!dir || !nodeFileSystem.exists(join(dir, "release.json"))) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_RELEASE_ID_MISSING,
          message: "no prepared local release found",
        }),
      );
    }
    return {
      ok: diagnostics.length === 0,
      data: { releaseDir: dir },
      diagnostics,
      exitCode: diagnostics.length === 0 ? 0 : 1,
    };
  }

  if (options.area === "artifacts" && options.action === "collect") {
    const releaseId = options.releaseId ?? "local";
    const collected = collectReleaseArtifacts(options.workspaceRoot, releaseId);
    return {
      ok: true,
      data: collected,
      diagnostics: collected.artifactManifest.diagnostics,
      exitCode: 0,
    };
  }

  if (options.area === "artifacts" && (options.action === "list" || options.action === "verify")) {
    const dir = options.releaseId
      ? releaseDir(options.workspaceRoot, options.releaseId)
      : latestReleaseDir(options.workspaceRoot);
    const manifest = dir ? readJson<{ artifacts?: unknown[]; diagnostics?: Diagnostic[] }>(join(dir, "artifacts.json")) : null;
    if (!manifest) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: FORGE_RELEASE_ARTIFACT_MISSING,
            message: "artifact manifest not found; run forge release prepare",
          }),
        ],
        exitCode: 1,
      };
    }
    return {
      ok: true,
      data: manifest,
      diagnostics: manifest.diagnostics ?? [],
      exitCode: 0,
    };
  }

  if (options.area === "artifacts" && options.action === "export") {
    const provider = options.target ?? "local";
    const diagnostics = providerConfigDiagnostics(provider);
    return {
      ok: diagnostics.length === 0,
      data: { provider, uploaded: false, dryRun: provider !== "local" },
      diagnostics,
      exitCode: diagnostics.length === 0 ? 0 : 1,
    };
  }

  if (options.area === "sourcemaps" && (options.action === "collect" || options.action === "check")) {
    const releaseId = options.releaseId ?? "local";
    const collected = collectReleaseArtifacts(options.workspaceRoot, releaseId);
    const diagnostics = options.allowPublicSourcemaps
      ? []
      : collected.sourceMapManifest.diagnostics;
    return {
      ok: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
      data: collected.sourceMapManifest,
      diagnostics,
      exitCode: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0,
    };
  }

  if (options.area === "sourcemaps" && options.action === "symbolicate") {
    if (!options.input) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: FORGE_SOURCEMAP_UPLOAD_MISSING,
            message: "--input stacktrace.json is required",
          }),
        ],
        exitCode: 1,
      };
    }
    const manifest = sourceMapManifestFor(options);
    const stacktrace = readJson<StacktraceInput>(options.input);
    if (!manifest || !stacktrace) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: FORGE_RELEASE_ARTIFACT_MISSING,
            message: "source map manifest or stacktrace input is missing",
          }),
        ],
        exitCode: 1,
      };
    }
    const result = symbolicateStacktrace({
      workspaceRoot: options.workspaceRoot,
      manifest,
      stacktrace,
    });
    return {
      ok: true,
      data: result,
      diagnostics: result.diagnostics,
      exitCode: 0,
    };
  }

  if (options.area === "sourcemaps" && options.action === "upload") {
    const provider = options.provider ?? "sentry";
    const diagnostics = providerConfigDiagnostics(provider);
    return {
      ok: diagnostics.length === 0,
      data: { provider, uploaded: false, dryRun: true },
      diagnostics,
      exitCode: diagnostics.length === 0 ? 0 : 1,
    };
  }

  return { ok: false, diagnostics: [], exitCode: 1 };
}

function missingRelease(): ReleaseCommandResult {
  return {
    ok: false,
    diagnostics: [
      createDiagnostic({
        severity: "error",
        code: FORGE_RELEASE_ID_MISSING,
        message: "release not found",
      }),
    ],
    exitCode: 1,
  };
}

export function formatReleaseJson(result: ReleaseCommandResult): string {
  return `${JSON.stringify(result)}\n`;
}

export function formatReleaseHuman(result: ReleaseCommandResult): string {
  if (!result.ok) {
    return result.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`).join("\n").concat("\n");
  }
  return `${JSON.stringify(result.data, null, 2)}\n`;
}
