import { dirname, join, parse } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import { parsePackageName } from "./parse-spec.ts";

function packageJsonPath(cwd: string, packageName: string): string {
  const segments = packageName.startsWith("@")
    ? packageName.split("/")
    : [packageName];
  return join(cwd, "node_modules", ...segments, "package.json");
}

function readVersionAt(path: string): string | null {
  if (!nodeFileSystem.exists(path)) {
    return null;
  }

  try {
    const pkg = JSON.parse((nodeFileSystem.readText(path) ?? "")) as {
      version?: string;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export function readInstalledVersion(
  specOrName: string,
  cwd: string,
): string | null {
  const name = parsePackageName(specOrName);
  let current = cwd;
  const root = parse(cwd).root;

  while (true) {
    const version = readVersionAt(packageJsonPath(current, name));
    if (version) {
      return version;
    }

    if (current === root) {
      return null;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
