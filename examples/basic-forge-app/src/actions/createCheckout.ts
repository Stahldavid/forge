import { action } from "forge/server";
import { createStripeClient } from "../lib/stripeClient.js";

export const createCheckout = action({
  handler: async (ctx) => {
    const stripe = createStripeClient(ctx.secrets);
    return stripe.customers;
  },
});
