import { command } from "forge/server";
import { stripe } from "../lib/stripeClient.js";

export const badStripeCommand = command(async () => {
  return stripe;
});
