import { command } from "forge/server";
import { stripeClient } from "./guard-stripe-helper";

export const charge = command(async () => {
  return stripeClient;
});
