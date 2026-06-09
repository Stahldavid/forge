import { command } from "forge/server";
import { charge } from "./commands";
import Stripe from "stripe";

export const payments = command(async () => {
  const client = new Stripe("sk_test");
  return charge;
});
