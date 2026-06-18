import { describe, expect, test } from "bun:test";
import { FORGE_POLICY_DENIED } from "../../src/forge/compiler/diagnostics/codes.ts";
import { cleanupWorkspace, scaffoldClientWorkspace, startClientDevServer } from "./helpers.ts";

describe("client errors", () => {
  test("FORGE_POLICY_DENIED becomes ForgeError with code and traceId", async () => {
    const { root, tenantA } = await scaffoldClientWorkspace("client-errors");
    const handle = await startClientDevServer(root, { db: "memory" });

    try {
      const { createForgeClient, api, ForgeError } = await import(
        `${root}/src/forge/_generated/client.ts`
      );

      const client = createForgeClient({
        url: handle.url,
        auth: { userId: "u1", tenantId: tenantA, role: "member" },
      });

      try {
        await client.command(api.commands.manageBilling, {});
        throw new Error("expected policy denial");
      } catch (error) {
        expect(error).toBeInstanceOf(ForgeError);
        const forgeError = error as InstanceType<typeof ForgeError>;
        expect(forgeError.code).toBe(FORGE_POLICY_DENIED);
        expect(forgeError.traceId).toBeDefined();
        expect(forgeError.status).toBe(403);
      }
    } finally {
      handle.stop();
      cleanupWorkspace(root);
    }
  });
});
