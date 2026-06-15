import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import type { EmitFile } from "../../src/forge/compiler/types/emit.ts";
import { render, renderBody } from "../../src/forge/compiler/emitter/render.ts";
import { serializeForgeLock } from "../../src/forge/compiler/emitter/lock.ts";
import { buildBarrelIndexBody } from "../../src/forge/compiler/emitter/barrel.ts";
import {
  hashStable,
  formatDeterministicHeader,
} from "../../src/forge/compiler/primitives/index.ts";
import { makeSampleEmitPlan, makeSampleLock } from "./helpers.ts";

const pathArb = fc
  .tuple(
    fc.constantFrom("appGraph", "packageGraph", "runtimeMatrix", "importGuards"),
    fc.constantFrom("ts", "json"),
  )
  .map(([name, ext]) => `src/forge/_generated/${name}.${ext}`);

const emitFileArb: fc.Arbitrary<EmitFile> = fc
  .tuple(pathArb, fc.string({ minLength: 1, maxLength: 80 }))
  .map(([path, payload]) => {
    const content = `${payload}\n`;
    const draft = { path, content } as EmitFile;
    return {
      path,
      content,
      contentHash: hashStable(renderBody(draft)),
    };
  });

describe("Property 1: Determinism", () => {
  test("render is byte-identical across repeated runs", () => {
    fc.assert(
      fc.property(fc.array(emitFileArb, { minLength: 1, maxLength: 8 }), (files) => {
        const context = {
          generatorVersion: "0.0.0",
          inputHash: "determinism-input-hash",
        };

        for (const file of files) {
          const first = render(file, context);
          const second = render(file, context);
          expect(second).toBe(first);
        }
      }),
      { numRuns: 50 },
    );
  });

  test("serializeForgeLock is byte-identical across repeated runs", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5 }), () => {
        const lock = makeSampleLock();
        const first = serializeForgeLock(lock);
        const second = serializeForgeLock(lock);
        expect(second).toBe(first);
      }),
      { numRuns: 30 },
    );
  });

  test("buildBarrelIndexBody is invariant under export path permutation", () => {
    fc.assert(
      fc.property(fc.array(pathArb, { minLength: 0, maxLength: 6 }), (paths) => {
        const baseline = buildBarrelIndexBody(paths);
        for (let seed = 0; seed < 4; seed++) {
          const permuted = [...paths];
          let state = (seed + 1) >>> 0;
          for (let i = permuted.length - 1; i > 0; i--) {
            state = (state * 1664525 + 1013904223) >>> 0;
            const j = state % (i + 1);
            [permuted[i], permuted[j]] = [permuted[j]!, permuted[i]!];
          }
          expect(buildBarrelIndexBody(permuted)).toBe(baseline);
        }
      }),
      { numRuns: 40 },
    );
  });

  test("rendered artifacts include a timestamp-free deterministic header", () => {
    const plan = makeSampleEmitPlan();
    const context = {
      generatorVersion: plan.lock.generatorVersion,
      inputHash: plan.lock.inputHash,
    };

    for (const file of plan.files) {
      const rendered = render(file, context);
      expect(rendered.startsWith("// @forge-generated")).toBe(true);
      expect(rendered).not.toMatch(/timestamp/i);
      expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      expect(formatDeterministicHeader).toBeDefined();
    }
  });
});
