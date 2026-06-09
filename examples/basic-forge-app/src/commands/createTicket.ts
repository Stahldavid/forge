import { command } from "forge/server";
import { z } from "zod";

const ticketSchema = z.object({
  title: z.string(),
});

export const createTicket = command(async () => {
  return ticketSchema.parse({ title: "demo" });
});
