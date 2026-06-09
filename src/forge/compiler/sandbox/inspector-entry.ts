/**
 * Spawnable entry for sandbox runtime export inspection.
 * Reads install path from argv[2] and prints JSON RuntimeExportShape to stdout.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

interface PackageJson {
  name?: string;
  main?: string;
  module?: string;
  exports?: unknown;
}

function resolveMainFile(pkgDir: string, pkg: PackageJson): string {
  if (typeof pkg.main === "string" && pkg.main.length > 0) {
    return join(pkgDir, pkg.main);
  }
  if (typeof pkg.module === "string" && pkg.module.length > 0) {
    return join(pkgDir, pkg.module);
  }

  const exports = pkg.exports;
  if (typeof exports === "object" && exports != null && !Array.isArray(exports)) {
    const root = (exports as Record<string, unknown>)["."];
    if (typeof root === "string") {
      return join(pkgDir, root);
    }
    if (typeof root === "object" && root != null) {
      const importPath = (root as Record<string, unknown>).import;
      if (typeof importPath === "string") {
        return join(pkgDir, importPath);
      }
      const requirePath = (root as Record<string, unknown>).require;
      if (typeof requirePath === "string") {
        return join(pkgDir, requirePath);
      }
      const defaultPath = (root as Record<string, unknown>).default;
      if (typeof defaultPath === "string") {
        return join(pkgDir, defaultPath);
      }
    }
  }

  return join(pkgDir, "index.js");
}

function classifyExport(value: unknown): "function" | "class" | "const" | "object" | "unknown" {
  if (typeof value === "function") {
    const proto = value.prototype;
    if (proto != null && proto.constructor === value) {
      return "class";
    }
    return "function";
  }
  if (typeof value === "object" && value != null) {
    return "object";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return "const";
  }
  return "unknown";
}

async function main(): Promise<void> {
  const installPath = process.argv[2];
  if (installPath == null || installPath.length === 0) {
    process.stderr.write("missing install path\n");
    process.exit(2);
  }

  const pkgPath = join(installPath, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  const mainFile = resolveMainFile(installPath, pkg);
  const mod = await import(pathToFileURL(mainFile).href);

  const exportNames = new Set<string>();
  if (mod != null && typeof mod === "object") {
    for (const key of Object.keys(mod)) {
      if (key !== "default") {
        exportNames.add(key);
      }
    }
    if ("default" in mod && mod.default != null) {
      exportNames.add("default");
    }
  }

  const exports = [...exportNames]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      kind: classifyExport(name === "default" ? mod.default : mod[name]),
    }));

  const shape = {
    entrypoints: [{ subpath: ".", exports }],
  };

  process.stdout.write(`${JSON.stringify(shape)}\n`);
}

const entryPath = fileURLToPath(import.meta.url);
if (process.argv[1] != null && process.argv[1] === entryPath) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error));
    process.exit(1);
  });
}
