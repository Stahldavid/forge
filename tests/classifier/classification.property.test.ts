import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { classify } from "../../src/forge/compiler/classifier/index.ts";
import {
  list,
  resolveRecipe,
} from "../../src/forge/compiler/recipes/index.ts";
import {
  DETERMINISTIC_CONTEXTS,
  RUNTIME_CONTEXTS,
} from "../../src/forge/compiler/types/runtime.ts";
import { makeExport, makePackageApi } from "../helpers/package-api.ts";

const signatureArb = fc.oneof(
  fc.constant("function pure(x: number): number"),
  fc.constant("function fetchData(): Promise<Response>"),
  fc.constant("import fs from 'fs'; function read(): string"),
  fc.constant("function run(): void; // process.env.SECRET_KEY"),
);

describe("Property 8: Classification Totality & Unknown-Is-Incompatible", () => {
  test("compatible and incompatible partition all 12 contexts for recipe packages", () => {
    fc.assert(
      fc.property(fc.constantFrom(...list().map((r) => r.alias)), (alias) => {
        const recipe = resolveRecipe(alias)!;
        const api = makePackageApi({
          name: recipe.packages[0]!.packageName,
          entrypoints: [
            {
              subpath: ".",
              conditions: ["import"],
              patternBacked: false,
              dtsPath: "index.d.ts",
              exports: [makeExport("main", "function main(): void")],
            },
          ],
        });

        const result = classify(api, recipe);
        const union = new Set([...result.compatible, ...result.incompatible]);

        expect(result.compatible.length + result.incompatible.length).toBe(12);
        expect(union.size).toBe(12);
        for (const ctx of RUNTIME_CONTEXTS) {
          expect(union.has(ctx)).toBe(true);
        }

        const overlap = result.compatible.filter((c) => result.incompatible.includes(c));
        expect(overlap).toEqual([]);
      }),
      { numRuns: 50 },
    );
  });

  test("unknown capability forces deterministic contexts into incompatible (heuristic)", () => {
    fc.assert(
      fc.property(signatureArb, (signature) => {
        const api = makePackageApi({
          name: "heuristic-pkg",
          entrypoints: [
            {
              subpath: ".",
              conditions: ["import"],
              patternBacked: false,
              dtsPath: null,
              exports: [makeExport("fn", signature)],
            },
          ],
        });

        const result = classify(api);
        const caps = result.perEntrypoint[0]?.capabilities;
        const hasUnknown =
          caps?.network.status === "unknown" ||
          caps?.filesystem.status === "unknown" ||
          caps?.process.status === "unknown";

        if (hasUnknown) {
          for (const ctx of DETERMINISTIC_CONTEXTS) {
            expect(result.incompatible).toContain(ctx);
          }
        }
      }),
      { numRuns: 30 },
    );
  });

  test("every context has a non-empty rationale", () => {
    fc.assert(
      fc.property(fc.constantFrom("stripe", "zod", "ai"), (alias) => {
        const recipe = resolveRecipe(alias)!;
        const result = classify(makePackageApi({ name: recipe.packages[0]!.packageName }), recipe);

        for (const ctx of RUNTIME_CONTEXTS) {
          expect(result.rationale[ctx].length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 20 },
    );
  });
});
