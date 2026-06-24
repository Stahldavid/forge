import { command } from "forge/server";
import { createStripeClient } from "../lib/stripeClient.js";

export const badStripeCommand = command({
  handler: async (ctx) => {
    return createStripeClient(ctx.secrets);
  },
});
