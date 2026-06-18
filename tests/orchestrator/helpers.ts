import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FIXTURE_PACKAGES } from "../package-graph/helpers.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const APP_GRAPH_FIXTURES = join(import.meta.dir, "..", "app-graph", "fixtures");
const PACKAGE_FIXTURES = join(import.meta.dir, "..", "fixtures", "packages");

export function tempWorkspace(prefix: string): string {
  const dir = join(import.meta.dir, ".tmp", `${prefix}-${Bun.randomUUIDv7()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupWorkspace(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function copyPackageFixture(workspace: string, packageName: string): void {
  const target = join(workspace, "node_modules", packageName);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(
    join(PACKAGE_FIXTURES, packageName),
    target,
    {
      recursive: true,
      force: true,
    },
  );
}

export function scaffoldGenerateWorkspace(
  prefix: string,
  options: { packageFixtures?: string[] } = {},
): string {
  const workspace = tempWorkspace(prefix);

  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "forge-orchestrator-test",
        private: true,
        type: "module",
        dependencies: {
          zod: "^3.24.0",
        },
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
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(join(workspace, "src", "forge", "_generated"), { recursive: true });

  for (const name of ["queries.ts", "commands.ts", "schema.ts"]) {
    const source = readFileSync(join(APP_GRAPH_FIXTURES, name), "utf8");
    writeFileSync(join(srcDir, name), source, "utf8");
  }

  mkdirSync(join(workspace, "node_modules"), { recursive: true });
  for (const fixture of options.packageFixtures ?? ["forge", "zod"]) {
    copyPackageFixture(workspace, fixture);
  }

  return workspace;
}

export function defaultGenerateOptions(workspace: string) {
  return {
    workspaceRoot: workspace,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 2,
  };
}

export { REPO_ROOT, FIXTURE_PACKAGES };
