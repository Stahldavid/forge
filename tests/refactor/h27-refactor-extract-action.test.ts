import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runRefactorCommand } from "../../src/forge/cli/refactor.ts";
import { cleanupWorkspace } from "../orchestrator/helpers.ts";
import { refactorOptions, scaffoldRefactorWorkspace } from "./h27-helpers.ts";

describe("H27 safe refactor extract-action", () => {
  // Every case here is a dry-run that only differs by the createCheckout.ts
  // source, so the (cpSync-heavy) workspace scaffold is shared once instead of
  // being rebuilt per test.
  let root: string;

  beforeAll(() => {
    root = scaffoldRefactorWorkspace("h27-extract-action");
  });

  afterAll(() => {
    cleanupWorkspace(root);
  });

  function writeCommand(source: string): void {
    writeFileSync(join(root, "src", "commands", "createCheckout.ts"), source, "utf8");
  }

  test("extract-action refuses unsafe non-block handlers with inline fix hints", async () => {
    writeCommand(
      `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => new Stripe("sk_test").checkout.sessions.create({ mode: "payment" }),
          });
        `,
    );
    const result = await runRefactorCommand(
      refactorOptions(root, {
        action: "extract-action",
        from: "createCheckout",
        packageName: "stripe",
        eventName: "checkout.requested",
        actionName: "createCheckoutSession",
        dryRun: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
    expect(result.diagnostics[0]?.fixHint).toBeTruthy();
    expect(existsSync(join(root, "src", "actions", "createCheckoutSession.ts"))).toBe(false);
  });

  test("extract-action refuses package bindings used outside the handler", async () => {
    writeCommand(
      `
          import Stripe from "stripe";
          import { command } from "forge/server";
          const stripeVersion = Stripe.VERSION;
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
            },
          });
          export const version = stripeVersion;
        `,
    );
    const result = await runRefactorCommand(
      refactorOptions(root, {
        action: "extract-action",
        from: "createCheckout",
        packageName: "stripe",
        eventName: "checkout.requested",
        actionName: "createCheckoutSession",
        dryRun: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
    expect(result.diagnostics[0]?.message).toContain("outside the extracted handler");
  });

  test("extract-action refuses unused package imports instead of deleting them blindly", async () => {
    writeCommand(
      `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              return { planId: input.planId };
            },
          });
        `,
    );
    const result = await runRefactorCommand(
      refactorOptions(root, {
        action: "extract-action",
        from: "createCheckout",
        packageName: "stripe",
        eventName: "checkout.requested",
        actionName: "createCheckoutSession",
        dryRun: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
    expect(result.diagnostics[0]?.message).toContain("not referenced inside");
  });

});
