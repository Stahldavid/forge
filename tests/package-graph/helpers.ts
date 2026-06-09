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

export const FIXTURE_PACKAGES = {
  zod: fixtureDependency("zod", "3.24.0"),
  stripe: fixtureDependency("stripe", "17.0.0"),
  posthogJs: fixtureDependency("posthog-js", "1.200.0"),
  posthogNode: fixtureDependency("posthog-node", "4.0.0"),
  ai: fixtureDependency("ai", "4.0.0"),
  patternLib: fixtureDependency("pattern-lib", "1.0.0"),
  untypedLib: fixtureDependency("untyped-lib", "1.0.0"),
  needsTypesPackage: fixtureDependency("needs-types-package", "1.0.0"),
  overloadLib: fixtureDependency("overload-lib", "1.0.0"),
} as const;

export function tempCacheDir(prefix: string): string {
  return join(import.meta.dir, "..", "..", ".forge", "test-cache", prefix);
}
