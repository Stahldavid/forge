import { command } from "forge/server";

export const createTicket = command(async () => {
  return { id: "ticket_1", title: "demo" };
});
