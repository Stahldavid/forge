import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackageName } from "./parse-spec.ts";

export function readInstalledVersion(
  specOrName: string,
  cwd: string,
): string | null {
  const name = parsePackageName(specOrName);
  const segments = name.startsWith("@")
    ? name.split("/")
    : [name];
  const pkgJsonPath = join(cwd, "node_modules", ...segments, "package.json");

  if (!nodeFileSystem.exists(pkgJsonPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse((nodeFileSystem.readText(pkgJsonPath) ?? "")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
