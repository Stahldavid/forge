import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { detectPackageManager, getLockfileForPm } from "../package-manager/detect.ts";
import { FORGE_LOCK_PATH } from "../emitter/constants.ts";
import { manifestPath } from "../orchestrator/manifest.ts";

export interface VersionControlledSnapshot {
  files: Map<string, string | null>;
}

function readOptional(path: string): string | null {
  return nodeFileSystem.readText(path);
}

export function snapshotVersionControlled(
  workspaceRoot: string,
): VersionControlledSnapshot {
  const pm = detectPackageManager(workspaceRoot);
  const lockfile = getLockfileForPm(pm);
  const paths = [
    "package.json",
    lockfile,
    FORGE_LOCK_PATH,
    manifestPath(join(workspaceRoot, ".forge", "cache")).replace(
      `${workspaceRoot.replace(/\\/g, "/")}/`,
      "",
    ),
  ];

  const files = new Map<string, string | null>();
  for (const relative of paths) {
    const normalized = relative.replace(/\\/g, "/");
    files.set(normalized, readOptional(join(workspaceRoot, normalized)));
  }

  return { files };
}

export function restoreVersionControlledSnapshot(
  workspaceRoot: string,
  snapshot: VersionControlledSnapshot,
): void {
  for (const [relative, content] of snapshot.files) {
    const absolute = join(workspaceRoot, relative);
    if (content === null) {
      nodeFileSystem.remove(absolute);
      continue;
    }

    nodeFileSystem.writeText(absolute, content);
  }
}
