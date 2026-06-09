import { action } from "forge/server";
import { stripe } from "../lib/stripeClient.js";

export const createCheckout = action(async () => {
  return stripe.checkout;
});
