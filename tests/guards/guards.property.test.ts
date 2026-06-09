import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { checkImportGuards } from "../../src/forge/compiler/guards/check-import-guards.ts";
import { FORGE_GUARD_VIOLATION } from "../../src/forge/compiler/diagnostics/codes.ts";
import {
  DETERMINISTIC_CONTEXTS,
  RUNTIME_CONTEXTS,
  type RuntimeContext,
} from "../../src/forge/compiler/types/runtime.ts";
import type { RuntimeMatrixEntry } from "../../src/forge/compiler/types/runtime-matrix.ts";
import { RECIPE_SCHEMA_VERSION } from "../../src/forge/compiler/recipes/definitions.ts";
import {
  graphFromNodes,
  linkModules,
  makeModuleNode,
} from "./helpers.ts";

const contextArb = fc.constantFrom(...RUNTIME_CONTEXTS);

function partitionContexts(
  chosenIncompatible: RuntimeContext[],
): { compatible: RuntimeContext[]; incompatible: RuntimeContext[] } {
  const incompatible = [...new Set(chosenIncompatible)];
  const compatible = RUNTIME_CONTEXTS.filter((ctx) => !incompatible.includes(ctx));
  return { compatible, incompatible };
}

function makeMatrixEntry(
  packageName: string,
  incompatible: RuntimeContext[],
): RuntimeMatrixEntry {
  const { compatible, incompatible: inc } = partitionContexts(incompatible);
  const rationale = Object.fromEntries(
    RUNTIME_CONTEXTS.map((ctx) => [ctx, inc.includes(ctx) ? "blocked" : "ok"]),
  ) as Record<RuntimeContext, string>;

  return {
    alias: packageName,
    packageName,
    compatible,
    incompatible: inc,
    rationale,
    perEntrypoint: [],
  };
}

describe("Property 7: Transitive Guard Soundness", () => {
  test("error iff effective context is in package incompatible set", () => {
    fc.assert(
      fc.property(
        fc.array(contextArb, { minLength: 1, maxLength: 3 }),
        fc.array(contextArb, { minLength: 0, maxLength: 4 }),
        (declaredContexts, incompatibleContexts) => {
          const packageName = "prop-pkg";
          const entry = makeMatrixEntry(packageName, incompatibleContexts);
          const matrix = {
            schemaVersion: RECIPE_SCHEMA_VERSION,
            entries: [entry],
          };

          const helper = makeModuleNode("src/lib/helper.ts", {
            packageImports: [
              {
                specifier: packageName,
                packageName,
                subpath: "",
                span: { start: 1, end: 5 },
                importKind: "static",
              },
            ],
          });

          const contexts = [...new Set(declaredContexts)] as RuntimeContext[];
          const entryNode = makeModuleNode("src/entry.ts", {
            declaredContexts: contexts,
          });
          linkModules(entryNode, helper);

          const diagnostics = checkImportGuards(
            graphFromNodes([entryNode, helper]),
            matrix,
          );

          const violations = diagnostics.filter(
            (diagnostic) => diagnostic.code === FORGE_GUARD_VIOLATION,
          );

          const expectedPairs = new Set<string>();
          for (const context of helper.effectiveContexts) {
            if (entry.incompatible.includes(context)) {
              expectedPairs.add(`${packageName}|${context}`);
            }
          }

          expect(violations.length).toBe(expectedPairs.size);

          for (const diagnostic of violations) {
            const contextMatch = /'([^']+)' context/.exec(diagnostic.message);
            const pkgMatch = /^'([^']+)' is not allowed/.exec(diagnostic.message);
            const context = contextMatch?.[1] as RuntimeContext;
            const pkg = pkgMatch?.[1];
            expect(pkg).toBe(packageName);
            expect(entry.incompatible).toContain(context);
            expect(helper.effectiveContexts).toContain(context);
          }

          for (const context of helper.effectiveContexts) {
            if (!entry.incompatible.includes(context)) {
              expect(
                violations.some((diagnostic) =>
                  diagnostic.message.includes(`'${context}' context`),
                ),
              ).toBe(false);
            }
          }
        },
      ),
      { numRuns: 80 },
    );
  });

  test("multi-context helper satisfies every effective context", () => {
    fc.assert(
      fc.property(
        fc.subarray(DETERMINISTIC_CONTEXTS as unknown as RuntimeContext[], {
          minLength: 2,
        }),
        (contexts) => {
          const packageName = "multi-ctx-pkg";
          const incompatible: RuntimeContext[] = [contexts[0]!];
          const entry = makeMatrixEntry(packageName, incompatible);
          const matrix = {
            schemaVersion: RECIPE_SCHEMA_VERSION,
            entries: [entry],
          };

          const helper = makeModuleNode("src/shared/helper.ts", {
            packageImports: [
              {
                specifier: packageName,
                packageName,
                subpath: "",
                span: { start: 2, end: 6 },
                importKind: "static",
              },
            ],
          });

          const nodes = [helper];
          for (let i = 0; i < contexts.length; i++) {
            const entryNode = makeModuleNode(`src/entry-${i}.ts`, {
              declaredContexts: [contexts[i]!],
            });
            linkModules(entryNode, helper);
            nodes.push(entryNode);
          }

          const diagnostics = checkImportGuards(graphFromNodes(nodes), matrix);
          const violations = diagnostics.filter(
            (diagnostic) => diagnostic.code === FORGE_GUARD_VIOLATION,
          );

          expect(violations.length).toBe(1);
          expect(violations[0].message).toContain(contexts[0]!);
        },
      ),
      { numRuns: 40 },
    );
  });
});
