import { join } from "node:path";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { EmitFile, EmitMode, EmitPlan } from "../types/emit.ts";
import {
  forgeDrift,
  forgeOrphanedGeneratedFile,
  forgeWriteError,
} from "../diagnostics/create.ts";
import {
  hashStable,
  normalizePath,
  stableSortByPath,
  stableSortEmitFiles,
  stripDeterministicHeader,
} from "../primitives/index.ts";
import { buildBarrelIndexBody } from "./barrel.ts";
import {
  BARREL_INDEX_PATH,
  FORGE_LOCK_PATH,
  GENERATED_DIR,
} from "./constants.ts";
import { serializeForgeLock } from "./lock.ts";
import { render, renderBody, type RenderContext } from "./render.ts";
import {
  readTextFileIfExists,
  removeFileIfExists,
  writeFileAtomic,
} from "./write.ts";

export interface EmitOptions {
  workspaceRoot: string;
  mode: EmitMode;
}

export interface EmitResult {
  changed: string[];
  unchanged: string[];
  removed: string[];
  wouldChange: string[];
  warnings: Diagnostic[];
  errors: Diagnostic[];
  exitCode: 0 | 1;
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return join(workspaceRoot, normalizePath(relativePath));
}

function bodiesDiffer(rendered: string, onDisk: string | null): boolean {
  const renderedBody = stripDeterministicHeader(rendered);
  if (onDisk === null) {
    return true;
  }
  const diskBody = stripDeterministicHeader(onDisk);
  return renderedBody !== diskBody;
}

function buildRenderContext(plan: EmitPlan): RenderContext {
  return {
    generatorVersion: plan.lock.generatorVersion,
    inputHash: plan.lock.inputHash,
  };
}

function upsertBarrelFile(files: EmitFile[], exportPaths: string[]): EmitFile[] {
  const body = buildBarrelIndexBody(exportPaths);
  const barrel: EmitFile = {
    path: BARREL_INDEX_PATH,
    content: body,
    contentHash: hashStable(body),
  };

  const withoutBarrel = files.filter((file) => file.path !== BARREL_INDEX_PATH);
  return stableSortEmitFiles([...withoutBarrel, barrel]);
}

function preparePlannedFiles(plan: EmitPlan): EmitFile[] {
  const exportPaths = plan.files.map((file) => file.path);
  return upsertBarrelFile(plan.files, exportPaths);
}

async function classifyFile(
  file: EmitFile,
  context: RenderContext,
  workspaceRoot: string,
): Promise<"changed" | "unchanged"> {
  const rendered = render(file, context);
  const absolutePath = resolveWorkspacePath(workspaceRoot, file.path);
  const onDisk = await readTextFileIfExists(absolutePath);
  return bodiesDiffer(rendered, onDisk) ? "changed" : "unchanged";
}

export async function emit(plan: EmitPlan, options: EmitOptions): Promise<EmitResult> {
  const { workspaceRoot, mode } = options;
  const context = buildRenderContext(plan);
  const plannedFiles = preparePlannedFiles(plan);
  const sortedOrphans = stableSortByPath([...plan.orphanedFiles]);

  const changed: string[] = [];
  const unchanged: string[] = [];
  const wouldChange: string[] = [];
  const removed: string[] = [];
  const warnings: Diagnostic[] = [];
  const errors: Diagnostic[] = [];

  for (const file of plannedFiles) {
    const rendered = render(file, context);
    const absolutePath = resolveWorkspacePath(workspaceRoot, file.path);
    const onDisk = await readTextFileIfExists(absolutePath);
    const differs = bodiesDiffer(rendered, onDisk);

    if (differs) {
      changed.push(file.path);
      wouldChange.push(file.path);

      if (mode === "check" || mode === "dry-run") {
        warnings.push(forgeDrift(file.path));
        continue;
      }

      try {
        await writeFileAtomic(absolutePath, rendered);
      } catch {
        errors.push(forgeWriteError(file.path));
      }
    } else {
      unchanged.push(file.path);
    }
  }

  for (const orphan of sortedOrphans) {
    const normalizedOrphan = normalizePath(orphan);
    if (!normalizedOrphan.startsWith(`${GENERATED_DIR}/`)) {
      continue;
    }

    const absoluteOrphan = resolveWorkspacePath(workspaceRoot, normalizedOrphan);

    if (mode === "check") {
      errors.push(forgeOrphanedGeneratedFile(normalizedOrphan));
      continue;
    }

    if (mode === "dry-run") {
      wouldChange.push(normalizedOrphan);
      continue;
    }

    const removedOrphan = await removeFileIfExists(absoluteOrphan);
    if (removedOrphan) {
      removed.push(normalizedOrphan);
    }
  }

  const lockDiffers = await lockWouldChange(plan, workspaceRoot);

  if (lockDiffers) {
    wouldChange.push(FORGE_LOCK_PATH);
    if (mode === "check" || mode === "dry-run") {
      warnings.push(forgeDrift(FORGE_LOCK_PATH));
    }
  }

  if (mode === "write" && errors.length === 0) {
    const lockContent = serializeForgeLock(plan.lock);
    const lockAbsolutePath = resolveWorkspacePath(workspaceRoot, FORGE_LOCK_PATH);

    try {
      if (lockDiffers) {
        await writeFileAtomic(lockAbsolutePath, lockContent);
        changed.push(FORGE_LOCK_PATH);
      } else {
        unchanged.push(FORGE_LOCK_PATH);
      }
    } catch {
      errors.push(forgeWriteError(FORGE_LOCK_PATH));
    }
  }

  const driftFailure =
    mode === "check" &&
    (changed.length > 0 || sortedOrphans.length > 0 || lockDiffers);
  const exitCode: 0 | 1 =
    errors.length > 0 || driftFailure ? 1 : 0;

  return {
    changed,
    unchanged,
    removed,
    wouldChange,
    warnings,
    errors,
    exitCode,
  };
}

async function lockWouldChange(plan: EmitPlan, workspaceRoot: string): Promise<boolean> {
  const lockContent = serializeForgeLock(plan.lock);
  const lockAbsolutePath = resolveWorkspacePath(workspaceRoot, FORGE_LOCK_PATH);
  const onDisk = await readTextFileIfExists(lockAbsolutePath);
  return onDisk !== lockContent;
}

/**
 * Exposed for tests: classify a single file without writing.
 */
export async function classifyPlannedFile(
  file: EmitFile,
  context: RenderContext,
  workspaceRoot: string,
): Promise<"changed" | "unchanged"> {
  return classifyFile(file, context, workspaceRoot);
}

export { render, renderBody, serializeForgeLock, buildBarrelIndexBody };
