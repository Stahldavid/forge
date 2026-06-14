import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SHOWCASE = join(import.meta.dir, "..", "..", "examples", "showcase-forge-app");

function read(relativePath: string): string {
  return readFileSync(join(SHOWCASE, relativePath), "utf8");
}

describe("ForgeOS showcase app", () => {
  test("is source-only and demonstrates the full-stack agent-native path", () => {
    expect(existsSync(join(SHOWCASE, "node_modules"))).toBe(false);
    expect(existsSync(join(SHOWCASE, "web", "node_modules"))).toBe(false);
    expect(existsSync(join(SHOWCASE, "forge.lock"))).toBe(false);
    expect(existsSync(join(SHOWCASE, "src", "forge", "_generated"))).toBe(false);

    expect(read(".gitignore")).toContain("src/forge/_generated/");
    expect(read(".gitignore")).toContain(".forge/agent-adapters/");
    expect(read("README.md")).toContain("ForgeOS Showcase App");
    expect(read("README.md")).toContain("capabilityMap");
    expect(read("README.md")).toContain("npm run generate");
    expect(read("README.md")).not.toContain("bun run");
    expect(read("package.json")).toContain('"dev:web": "cd web && npm run dev"');
    expect(read("package.json")).toContain('"test": "node ../../bin/forge-bun.mjs test"');
    expect(read("src/forge/schema.ts")).toContain("tickets");
    expect(read("src/commands/createTicket.ts")).toContain("ctx.emit");
    expect(read("src/queries/liveTickets.ts")).toContain("liveQuery");
    expect(read("src/actions/captureTicketCreated.ts")).toContain("ticket_created_action_processed");
    expect(read("src/workflows/triageTicketWorkflow.ts")).toContain("ctx.ai.generateText");
    expect(read("web/components/TicketList.tsx")).toContain("useLiveQuery");
    expect(read("web/components/CreateTicketForm.tsx")).toContain("useCommand");
    expect(read("web/components/TraceDetails.tsx")).toContain("traceId");
  });
});
