import { describe, expect, test } from "bun:test";
import { renderStripeServerAdapter } from "../../src/forge/compiler/integration/templates/stripe.ts";
import { renderPosthogServerAdapter } from "../../src/forge/compiler/integration/templates/posthog.ts";
import { STRIPE_RECIPE } from "../../src/forge/compiler/recipes/definitions.ts";

describe("generated adapters secrets", () => {
  test("stripe server adapter uses ctx.secrets pattern", () => {
    const source = renderStripeServerAdapter({
      alias: "stripe",
      recipe: STRIPE_RECIPE,
      context: "action",
      packageName: "stripe",
      packageNames: ["stripe"],
      secrets: STRIPE_RECIPE.secrets,
      compatible: ["action"],
      incompatible: ["command"],
    });

    expect(source).toContain('secrets.get("STRIPE_SECRET_KEY")');
    expect(source).not.toContain("process.env.STRIPE_SECRET_KEY");
  });

  test("posthog server adapter uses secrets and config", () => {
    const source = renderPosthogServerAdapter({
      alias: "posthog",
      recipe: STRIPE_RECIPE,
      context: "action",
      packageName: "posthog-node",
      packageNames: ["posthog-node"],
      secrets: [],
      compatible: ["action"],
      incompatible: ["command"],
    });

    expect(source).toContain('secrets.get("POSTHOG_KEY")');
    expect(source).not.toContain("process.env.POSTHOG_KEY");
  });
});
