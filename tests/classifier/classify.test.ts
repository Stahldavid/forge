import { describe, expect, test } from "bun:test";
import {
  buildRuntimeMatrix,
  classify,
  detectCapabilities,
  detectSecrets,
} from "../../src/forge/compiler/classifier/index.ts";
import { resolveRecipe } from "../../src/forge/compiler/recipes/index.ts";
import { RUNTIME_CONTEXTS } from "../../src/forge/compiler/types/runtime.ts";
import { makeExport, makePackageApi } from "../helpers/package-api.ts";

describe("Runtime Classifier determinism", () => {
  test("produces identical classification across repeated runs", () => {
    const api = makePackageApi({
      name: "stripe",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import", "types"],
          patternBacked: false,
          dtsPath: "index.d.ts",
          exports: [makeExport("Stripe", "class Stripe { constructor(apiKey: string) }")],
        },
      ],
    });

    const a = classify(api, resolveRecipe("stripe")!);
    const b = classify(api, resolveRecipe("stripe")!);

    expect(a.compatible).toEqual(b.compatible);
    expect(a.incompatible).toEqual(b.incompatible);
    expect(a.rationale).toEqual(b.rationale);
  });
});

describe("network rule", () => {
  test("marks command/query/liveQuery incompatible for stripe (network egress)", () => {
    const api = makePackageApi({ name: "stripe" });
    const result = classify(api, resolveRecipe("stripe")!);

    expect(result.incompatible).toContain("command");
    expect(result.incompatible).toContain("query");
    expect(result.incompatible).toContain("liveQuery");
    expect(result.rationale.command.length).toBeGreaterThan(0);
  });

  test("marks deterministic contexts incompatible when network detected via heuristics", () => {
    const api = makePackageApi({
      name: "custom-http",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import"],
          patternBacked: false,
          dtsPath: "index.d.ts",
          exports: [makeExport("get", "function get(url: string): Promise<Response>")],
        },
      ],
    });

    const result = classify(api);
    expect(result.incompatible).toContain("command");
    expect(result.incompatible).toContain("query");
    expect(result.incompatible).toContain("liveQuery");
  });
});

describe("tri-state capabilities", () => {
  test("recipe packages get manual confidence capabilities", () => {
    const caps = detectCapabilities(makePackageApi({ name: "stripe" }), resolveRecipe("stripe")!);
    expect(caps.network.status).toBe("required");
    expect(caps.network.confidence).toBe("manual");
    expect(caps.network.evidence).toContain("recipe:stripe");
  });

  test("unknown capabilities for heuristic packages block deterministic contexts", () => {
    const api = makePackageApi({
      name: "opaque-lib",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import"],
          patternBacked: false,
          dtsPath: null,
          exports: [makeExport("doThing", "function doThing(): void")],
        },
      ],
    });

    const caps = detectCapabilities(api);
    expect(caps.network.status).toBe("unknown");
    expect(caps.filesystem.status).toBe("unknown");

    const result = classify(api);
    expect(result.incompatible).toContain("command");
    expect(result.incompatible).toContain("query");
    expect(result.incompatible).toContain("liveQuery");
  });

  test("distinguishes not-detected from unknown", () => {
    const api = makePackageApi({
      name: "opaque-lib",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import"],
          patternBacked: false,
          dtsPath: null,
          exports: [makeExport("pure", "function pure(x: number): number")],
        },
      ],
    });

    const caps = detectCapabilities(api);
    expect(caps.nativeAddon.status).toBe("not-detected");
    expect(caps.network.status).toBe("unknown");
  });
});

describe("secret detection", () => {
  test("detects secrets from recipe with detectedFrom recipe", () => {
    const secrets = detectSecrets(makePackageApi({ name: "stripe" }), resolveRecipe("stripe")!);
    const names = secrets.map((s) => s.envVar);
    expect(names).toContain("STRIPE_SECRET_KEY");
    expect(names).toContain("STRIPE_WEBHOOK_SECRET");
    expect(secrets.every((s) => s.detectedFrom === "recipe")).toBe(true);
  });

  test("detects secrets from signature signals", () => {
    const api = makePackageApi({
      name: "custom",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import"],
          patternBacked: false,
          dtsPath: null,
          exports: [
            makeExport(
              "connect",
              "function connect(key: string): void; // uses process.env.MY_API_KEY",
            ),
          ],
        },
      ],
    });

    const secrets = detectSecrets(api);
    expect(secrets.some((s) => s.envVar === "MY_API_KEY" && s.detectedFrom === "signature")).toBe(
      true,
    );
  });

  test("zod has no secrets", () => {
    const secrets = detectSecrets(makePackageApi({ name: "zod" }), resolveRecipe("zod")!);
    expect(secrets).toEqual([]);
  });
});

describe("per-export granularity and runtime matrix detail", () => {
  test("classifies at per-entrypoint export granularity", () => {
    const api = makePackageApi({
      name: "zod",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import"],
          patternBacked: false,
          dtsPath: "index.d.ts",
          exports: [
            makeExport("z", "function z(): ZodType"),
            makeExport("string", "function string(): ZodString"),
          ],
        },
      ],
    });

    const result = classify(api, resolveRecipe("zod")!);
    expect(result.perEntrypoint).toHaveLength(2);
    expect(result.perEntrypoint[0]!.exportName).toBe("string");
    expect(result.perEntrypoint[1]!.exportName).toBe("z");
    expect(result.perEntrypoint.every((e) => e.compatible.includes("shared"))).toBe(true);
  });

  test("partitions all 12 runtime contexts", () => {
    const result = classify(makePackageApi({ name: "zod" }), resolveRecipe("zod")!);
    const union = [...result.compatible, ...result.incompatible];
    expect(union.sort()).toEqual([...RUNTIME_CONTEXTS].sort());
    for (const ctx of RUNTIME_CONTEXTS) {
      expect(result.rationale[ctx]).toBeTruthy();
    }
  });

  test("buildRuntimeMatrix produces sorted package entries with per-entrypoint detail", () => {
    const api = makePackageApi({ name: "stripe" });
    const recipe = resolveRecipe("stripe")!;
    const classification = classify(api, recipe);
    const matrix = buildRuntimeMatrix([{ api, classification, recipe }]);

    expect(matrix.entries).toHaveLength(1);
    expect(matrix.entries[0]!.alias).toBe("stripe");
    expect(matrix.entries[0]!.perEntrypoint).toEqual(classification.perEntrypoint);
  });
});
