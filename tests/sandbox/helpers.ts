import { join } from "node:path";
import type { Dependency } from "../../src/forge/compiler/types/package-graph.ts";

const FIXTURES_ROOT = join(import.meta.dir, "..", "fixtures", "packages");

export function fixtureDependency(
  name: string,
  version = "1.0.0",
): Dependency {
  return {
    name,
    version,
    packageManager: "bun",
    installPath: join(FIXTURES_ROOT, name),
  };
}

export const RUNTIME_FIXTURE = fixtureDependency("runtime-lib");
