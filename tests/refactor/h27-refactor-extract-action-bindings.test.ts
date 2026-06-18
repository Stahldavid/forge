import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runRefactorCommand } from "../../src/forge/cli/refactor.ts";
import { cleanupWorkspace } from "../orchestrator/helpers.ts";
import { refactorOptions, scaffoldRefactorWorkspace } from "./h27-helpers.ts";

describe("H27 safe refactor extract-action binding cases", () => {
  // The dry-run cases only differ by the createCheckout.ts source, so the
  // cpSync-heavy scaffold is shared once. The final apply case mutates the
  // workspace but runs last (afterAll cleans up), so the shared workspace is
  // safe to reuse.
  let root: string;

  beforeAll(() => {
    root = scaffoldRefactorWorkspace("h27-extract-bindings");
  });

  afterAll(() => {
    cleanupWorkspace(root);
  });

  function writeCommand(source: string): void {
    writeFileSync(join(root, "src", "commands", "createCheckout.ts"), source, "utf8");
  }

  test("extract-action is binding-aware and ignores shadowed local names", async () => {
    writeCommand(
      `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const Stripe = (_key: string) => ({ checkout: { sessions: { create: async () => input.planId } } });
              return Stripe("local").checkout.sessions.create();
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

  test("extract-action ignores type-only imports as runtime extraction targets", async () => {
    writeCommand(
      `
          import type Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { stripe: Stripe.Checkout.SessionCreateParams }) => {
              return { planId: input.stripe.mode };
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
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_TARGET_NOT_FOUND");
  });

  test("extract-action refuses side-effect imports with no analyzable binding", async () => {
    writeCommand(
      `
          import "stripe";
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
    expect(result.diagnostics[0]?.message).toContain("side-effect import");
  });

  test("extract-action preserves type-only specifiers from mixed imports", async () => {
    writeCommand(
      `
          import Stripe, { type StripeConfig } from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string; config: StripeConfig }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
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
        yes: true,
      }),
    );

    expect(result.ok).toBe(true);
    const commandSource = readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8");
    expect(commandSource).toContain('import type { StripeConfig } from "stripe";');
    expect(commandSource).not.toContain("import Stripe");
    expect(commandSource).toContain("config: StripeConfig");
    expect(commandSource).toContain('ctx.emit("checkout.requested"');
  });
});
