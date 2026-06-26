import { describe, expect, test } from "bun:test";
import {
  AI_PROVIDER_RECIPES,
  AI_RECIPE,
  list,
  resolveByPackageName,
  resolveRecipe,
  supports,
} from "../../src/forge/compiler/recipes/index.ts";

describe("Integration Recipe Registry", () => {
  test("resolves all reference aliases", () => {
    for (const alias of ["stripe", "posthog", "sentry", "zod", "workos", "ai"]) {
      const recipe = resolveRecipe(alias);
      expect(recipe).not.toBeNull();
      expect(recipe!.alias).toBe(alias);
      expect(recipe!.recipeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
    const convex = resolveRecipe("convex");
    expect(convex).not.toBeNull();
    expect(convex!.alias).toBe("convex");
    expect(convex!.recipeVersion).toBe("1.0.0");
  });

  test("supports() mirrors resolveRecipe()", () => {
    expect(supports("stripe")).toBe(true);
    expect(supports("unknown-pkg")).toBe(false);
  });

  test("returns null for unknown aliases (heuristic fallback path)", () => {
    expect(resolveRecipe("lodash")).toBeNull();
    expect(resolveRecipe("")).toBeNull();
  });

  test("maps stripe to npm package stripe", () => {
    const recipe = resolveRecipe("stripe")!;
    expect(recipe.packages.map((p) => p.packageName)).toEqual(["stripe"]);
  });

  test("maps posthog to posthog-js and posthog-node", () => {
    const recipe = resolveRecipe("posthog")!;
    expect(recipe.packages.map((p) => p.packageName)).toEqual([
      "posthog-js",
      "posthog-node",
    ]);
    expect(recipe.packages[0]!.role).toBe("client");
    expect(recipe.packages[1]!.role).toBe("server");
  });

  test("maps sentry to framework-dependent packages", () => {
    const recipe = resolveRecipe("sentry")!;
    expect(recipe.packages.map((p) => p.packageName)).toEqual([
      "@sentry/nextjs",
      "@sentry/node",
      "@sentry/browser",
    ]);
  });

  test("maps zod to pure shared-safe package", () => {
    const recipe = resolveRecipe("zod")!;
    expect(recipe.packages[0]!.packageName).toBe("zod");
    expect(recipe.contexts.denied).toEqual([]);
    expect(recipe.secrets).toEqual([]);
  });

  test("maps ai to ai core package", () => {
    const recipe = resolveRecipe("ai")!;
    expect(recipe.packages[0]!.packageName).toBe("ai");
  });

  test("maps convex to the Convex package with app-contract guardrails", () => {
    const recipe = resolveRecipe("convex")!;
    expect(recipe.packages[0]!.packageName).toBe("convex");
    expect(recipe.contexts.allowed).toContain("client");
    expect(recipe.contexts.allowed).toContain("server");
    expect(recipe.contexts.denied).toContain("command");
    expect(recipe.contexts.denied).toContain("query");
  });

  test("maps workos to the WorkOS Node SDK with auth guardrails", () => {
    const recipe = resolveRecipe("workos")!;
    expect(recipe.packages.map((p) => p.packageName)).toEqual(["@workos-inc/node"]);
    expect(recipe.contexts.allowed).toContain("server");
    expect(recipe.contexts.allowed).toContain("endpoint");
    expect(recipe.contexts.denied).toContain("command");
    expect(recipe.contexts.denied).toContain("query");
    expect(recipe.secrets.map((s) => s.envVar)).toEqual([
      "WORKOS_API_KEY",
      "WORKOS_CLIENT_ID",
      "WORKOS_COOKIE_PASSWORD",
      "WORKOS_REDIRECT_URI",
      "WORKOS_WEBHOOK_SECRET",
    ]);
  });

  test("classifies AI provider packages separately with their secrets", () => {
    const openai = resolveRecipe("ai-provider-openai")!;
    const anthropic = resolveRecipe("ai-provider-anthropic")!;

    expect(openai.packages[0]!.packageName).toBe("@ai-sdk/openai");
    expect(openai.secrets.map((s) => s.envVar)).toEqual(["OPENAI_API_KEY"]);

    expect(anthropic.packages[0]!.packageName).toBe("@ai-sdk/anthropic");
    expect(anthropic.secrets.map((s) => s.envVar)).toEqual(["ANTHROPIC_API_KEY"]);

    expect(AI_RECIPE.secrets.map((s) => s.envVar).sort()).toEqual([
      "AI_GATEWAY_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
    ]);
    expect(openai.alias).not.toBe(AI_RECIPE.alias);
  });

  test("resolveByPackageName finds recipes by npm package name", () => {
    expect(resolveByPackageName("posthog-js")?.alias).toBe("posthog");
    expect(resolveByPackageName("posthog-node")?.alias).toBe("posthog");
    expect(resolveByPackageName("convex")?.alias).toBe("convex");
    expect(resolveByPackageName("@ai-sdk/openai")?.alias).toBe("ai-provider-openai");
    expect(resolveByPackageName("nonexistent")).toBeNull();
  });

  test("list() returns all reference and provider recipes", () => {
    const recipes = list();
    const aliases = recipes.map((r) => r.alias);
    expect(aliases).toContain("stripe");
    expect(aliases).toContain("posthog");
    expect(aliases).toContain("sentry");
    expect(aliases).toContain("zod");
    expect(aliases).toContain("convex");
    expect(aliases).toContain("forge");
    expect(aliases).toContain("workos");
    expect(aliases).toContain("ai");
    expect(aliases).toContain("ai-provider-openai");
    expect(aliases).toContain("ai-provider-anthropic");
    expect(aliases).toContain("ai-gateway");
    expect(recipes.length).toBe(8 + AI_PROVIDER_RECIPES.length);
  });

  test("recipeVersion is exposed for cache key and forge.lock tracking", () => {
    for (const recipe of list()) {
      expect(recipe.recipeVersion).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
