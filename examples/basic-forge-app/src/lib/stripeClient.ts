import Stripe from "stripe";
import type { ForgeContext } from "forge/server";

const DEFAULT_API_VERSION = "2024-11-20.acacia";

export function createStripeClient(secrets: ForgeContext["secrets"]): Stripe {
  return new Stripe(secrets.get("STRIPE_SECRET_KEY"), { apiVersion: DEFAULT_API_VERSION });
}
