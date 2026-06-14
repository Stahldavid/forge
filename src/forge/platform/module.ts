import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function moduleDir(meta: ImportMeta): string {
  return dirname(fileURLToPath(meta.url));
}

export function isMainModule(meta: ImportMeta): boolean {
  const maybeBunMain = (meta as ImportMeta & { main?: boolean }).main;
  if (typeof maybeBunMain === "boolean") {
    return maybeBunMain;
  }

  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  return resolve(fileURLToPath(meta.url)) === resolve(entrypoint);
}
