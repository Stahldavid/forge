import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runRefactorCommand } from "../../src/forge/cli/refactor.ts";
import { cleanupWorkspace } from "../orchestrator/helpers.ts";
import { refactorOptions, scaffoldRefactorWorkspace } from "./h27-helpers.ts";

describe("H27 safe refactor extract-action apply", () => {
  test("extract-action removes forbidden import and creates action", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
            },
          });
        `,
        "utf8",
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
      expect(readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8")).not.toContain(
        'from "stripe"',
      );
      expect(readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8")).toContain(
        'ctx.emit("checkout.requested"',
      );
      expect(existsSync(join(root, "src", "actions", "createCheckoutSession.ts"))).toBe(true);
      const actionSource = readFileSync(join(root, "src", "actions", "createCheckoutSession.ts"), "utf8");
      expect(actionSource).toContain('import * as StripeIntegration from "stripe";');
      expect(actionSource).toContain("void StripeIntegration");
      expect(actionSource).toContain('integration: "stripe"');
    } finally {
      cleanupWorkspace(root);
    }
  }, 60_000);
});
