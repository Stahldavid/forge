import { createForgeClient, api } from "../forge/_generated/client.ts";

export async function runForgeClientDemo(baseUrl: string): Promise<void> {
  const client = createForgeClient({
    url: baseUrl,
    auth: { userId: "u1", tenantId: "t1", role: "member" },
  });

  const tickets = await client.query(api.queries.listTickets, {});
  console.log("listTickets", tickets);

  const created = await client.command(api.commands.createTicket, {
    title: "Bug",
  });
  console.log("createTicket", created);
}

if ((import.meta as ImportMeta & { main?: boolean }).main) {
  const argv = (globalThis as typeof globalThis & { process?: { argv?: string[] } }).process?.argv ?? [];
  const url = argv[2] ?? "http://127.0.0.1:3765";
  await runForgeClientDemo(url);
}
