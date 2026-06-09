import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CommandExecutor,
  CommandRunResult,
} from "../../src/forge/compiler/package-manager/executor.ts";
import {
  createPackageManagerAdapter,
  type PackageManagerAdapter,
} from "../../src/forge/compiler/package-manager/index.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
export const FIXTURE_PACKAGES = join(import.meta.dir, "..", "fixtures", "packages");
const APP_GRAPH_FIXTURES = join(import.meta.dir, "..", "app-graph", "fixtures");

export function tempWorkspace(prefix: string): string {
  const dir = join(import.meta.dir, ".tmp", `${prefix}-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function seedInstalledPackage(
  cwd: string,
  name: string,
  version: string,
): void {
  const segments = name.startsWith("@") ? name.slice(1).split("/") : [name];
  const pkgDir = join(cwd, "node_modules", ...segments);
  mkdirSync(pkgDir, { recursive: true });

  const fixturePath = join(FIXTURE_PACKAGES, ...segments);
  if (existsSync(fixturePath)) {
    cpSync(fixturePath, pkgDir, { recursive: true, force: true });
  }

  const pkgJsonPath = join(pkgDir, "package.json");
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
      name?: string;
      version?: string;
    };
    pkg.name = name;
    pkg.version = version;
    writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
    return;
  }

  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version }, null, 2),
    "utf8",
  );
}

export function scaffoldAddWorkspace(prefix: string): string {
  const workspace = tempWorkspace(prefix);

  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "forge-add-test",
        private: true,
        type: "module",
        dependencies: {},
      },
      null,
      2,
    ),
    "utf8",
  );

  writeFileSync(
    join(workspace, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
    "utf8",
  );

  const srcDir = join(workspace, "src", "forge");
  mkdirSync(join(workspace, "src", "forge", "_generated"), { recursive: true });
  for (const name of ["queries.ts", "commands.ts", "schema.ts"]) {
    writeFileSync(join(srcDir, name), readFileSync(join(APP_GRAPH_FIXTURES, name), "utf8"), "utf8");
  }

  cpSync(FIXTURE_PACKAGES, join(workspace, "node_modules"), {
    recursive: true,
    force: true,
  });

  return workspace;
}

export function createFixturePmAdapter(
  onAdd?: (spec: string, cwd: string) => void,
): PackageManagerAdapter {
  function extractSpecFromArgv(argv: string[]): string {
    if (argv[0] === "npm" && argv[1] === "install" && argv[2]) {
      return argv[2];
    }
    if (argv.length >= 3 && (argv[1] === "add" || argv[1] === "install")) {
      return argv[2]!;
    }
    return argv.at(-1) ?? "";
  }

  const executor: CommandExecutor = {
    async run(argv, options): Promise<CommandRunResult> {
      const spec = extractSpecFromArgv(argv);
      onAdd?.(spec, options.cwd);

      for (const pkg of spec.split(/\s+/).filter(Boolean)) {
        const name = pkg.split("@")[0]!;
        seedInstalledPackage(options.cwd, name, "1.0.0");
      }

      const pkgJsonPath = join(options.cwd, "package.json");
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf8")) as {
        dependencies?: Record<string, string>;
      };
      for (const pkgName of spec.split(/\s+/).filter(Boolean)) {
        const name = pkgName.split("@")[0]!;
        pkg.dependencies = { ...pkg.dependencies, [name]: "^1.0.0" };
      }
      writeFileSync(pkgJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };

  return createPackageManagerAdapter("npm", { executor });
}

export function createFailingPmAdapter(): PackageManagerAdapter {
  const executor: CommandExecutor = {
    async run() {
      return { exitCode: 1, stdout: "", stderr: "install failed" };
    },
  };
  return createPackageManagerAdapter("npm", { executor });
}

export { REPO_ROOT };
