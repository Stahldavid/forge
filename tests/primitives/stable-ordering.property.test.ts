import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import type { ForgeSymbol } from "../../src/forge/compiler/types/app-graph.ts";
import { compareBytes } from "../../src/forge/compiler/primitives/compare.ts";
import { hashStable } from "../../src/forge/compiler/primitives/hash.ts";
import {
  formatDeterministicHeader,
  prependDeterministicHeader,
} from "../../src/forge/compiler/primitives/header.ts";
import { serializeCanonical } from "../../src/forge/compiler/primitives/serialize.ts";
import { stableSortSymbols } from "../../src/forge/compiler/primitives/sort.ts";

const forgeKindArb = fc.constantFrom(
  "schema.table",
  "query",
  "liveQuery",
  "command",
  "endpoint",
  "policy",
  "workflow",
  "agent",
  "telemetryEvent",
);

const symbolArb: fc.Arbitrary<ForgeSymbol> = fc.record({
  id: fc.uuid(),
  kind: forgeKindArb,
  name: fc.string({ minLength: 1, maxLength: 12 }),
  qualifiedName: fc.string({ minLength: 1, maxLength: 20 }),
  file: fc
    .tuple(fc.constantFrom("src", "lib"), fc.stringMatching(/^[a-z]{2,6}$/))
    .map(([dir, name]) => `${dir}/${name}.ts`),
  span: fc.record({
    start: fc.integer({ min: 0, max: 1000 }),
    end: fc.integer({ min: 1001, max: 2000 }),
  }),
  contentHash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  meta: fc.constant({}),
});

function permute<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let i = copy.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

function renderSortedSymbolsSnapshot(symbols: ForgeSymbol[]): string {
  const sorted = stableSortSymbols(symbols);
  const body = serializeCanonical(
    sorted.map((s) => ({
      id: s.id,
      kind: s.kind,
      name: s.name,
      file: s.file,
      span: s.span,
    })),
  );
  return prependDeterministicHeader(body, {
    generatorVersion: "0.0.0",
    inputHash: hashStable(body),
  });
}

describe("Property 4: Stable Ordering", () => {
  test("sorted symbol snapshot is invariant under input permutation", () => {
    fc.assert(
      fc.property(fc.array(symbolArb, { minLength: 0, maxLength: 20 }), (symbols) => {
        const baseline = renderSortedSymbolsSnapshot(symbols);

        for (let i = 0; i < 5; i++) {
          const permuted = permute(symbols, 42 + i);
          const rendered = renderSortedSymbolsSnapshot(permuted);
          expect(rendered).toBe(baseline);
        }
      }),
      { numRuns: 50 },
    );
  });

  test("compareBytes defines a total order for random strings", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), (a, b, c) => {
        const ab = compareBytes(a, b);
        const bc = compareBytes(b, c);
        const ac = compareBytes(a, c);

        expect(compareBytes(a, a)).toBe(0);
        expect(compareBytes(b, a) + ab).toBe(0);

        if (ab <= 0 && bc <= 0) {
          expect(ac).toBeLessThanOrEqual(0);
        }
        if (ab >= 0 && bc >= 0) {
          expect(ac).toBeGreaterThanOrEqual(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  test("deterministic header has no timestamp fields", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 16 }),
        fc.hexaString({ minLength: 8, maxLength: 64 }),
        fc.hexaString({ minLength: 8, maxLength: 64 }),
        (generatorVersion, inputHash, contentHash) => {
          const header = formatDeterministicHeader({
            generatorVersion,
            inputHash,
            contentHash,
          });
          expect(header).not.toMatch(/timestamp/i);
          expect(header).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
        },
      ),
      { numRuns: 50 },
    );
  });
});
