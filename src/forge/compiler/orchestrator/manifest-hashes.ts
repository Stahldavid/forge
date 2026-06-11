import { buildBarrelIndexBody } from "../emitter/barrel.ts";
import { BARREL_INDEX_PATH, FORGE_LOCK_PATH } from "../emitter/constants.ts";
import { serializeForgeLock } from "../emitter/lock.ts";
import { renderBody } from "../emitter/render.ts";
import { hashStable } from "../primitives/hash.ts";
import type { EmitPlan } from "../types/emit.ts";

export function buildManifestFileHashes(plan: EmitPlan): Record<string, string> {
  const hashes: Record<string, string> = {};
  const exportPaths = plan.files.map((file) => file.path);

  for (const file of plan.files) {
    hashes[file.path] = hashStable(renderBody(file));
  }

  const barrelBody = buildBarrelIndexBody(exportPaths);
  hashes[BARREL_INDEX_PATH] = hashStable(barrelBody);
  hashes[FORGE_LOCK_PATH] = hashStable(serializeForgeLock(plan.lock));

  return hashes;
}
