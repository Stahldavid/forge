import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackageName } from "./parse-spec.ts";

export function readInstalledVersion(
  specOrName: string,
  cwd: string,
): string | null {
  const name = parsePackageName(specOrName);
  const segments = name.startsWith("@")
    ? name.slice(1).split("/")
    : [name];
  const pkgJsonPath = join(cwd, "node_modules", ...segments, "package.json");

  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}
