import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { mkdirSync, rmSync } from "node:fs";
import { PackageGraphCompiler } from "../../src/forge/compiler/package-graph/compiler.ts";
import { setReadFileTracker } from "../../src/forge/compiler/package-graph/read-file.ts";
import { FIXTURE_PACKAGES, tempCacheDir } from "./helpers.ts";

describe("Property 6: Static Safety", () => {
  test(
    "static analysis only reads declaration and manifest files",
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom("nodenext", "bundler") as fc.Arbitrary<
            "nodenext" | "bundler"
          >,
          fc.constantFrom(FIXTURE_PACKAGES.zod, FIXTURE_PACKAGES.overloadLib),
          async (mode, dep) => {
            const reads: string[] = [];
            setReadFileTracker({ recordRead: (path) => reads.push(path) });

            const cacheDir = tempCacheDir(`static-${dep.name}-${mode}`);
            mkdirSync(cacheDir, { recursive: true });

            try {
              const compiler = new PackageGraphCompiler();
              await compiler.analyze(dep, {
                runtimeInspect: false,
                resolutionMode: mode,
                cacheDir,
              });
            } finally {
              setReadFileTracker(undefined);
              rmSync(cacheDir, { recursive: true, force: true });
            }

            for (const path of reads) {
              expect(
                path.endsWith(".d.ts") || path.endsWith("package.json"),
              ).toBe(true);
              expect(path.endsWith(".js") || path.endsWith(".mjs")).toBe(false);
            }
          },
        ),
        { numRuns: 4 },
      );
    },
    { timeout: 60_000 },
  );
});
