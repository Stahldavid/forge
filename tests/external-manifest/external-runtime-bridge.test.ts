import { describe, expect, test } from "bun:test";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { importExternalManifest } from "../../src/forge/compiler/external-manifest/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
} from "../orchestrator/helpers.ts";
import {
  scaffoldClientWorkspace,
  startClientDevServer,
} from "../client/helpers.ts";
import {
  readJson,
  startExternalHttpService,
  writeExternalManifest,
} from "./external-runtime-helpers.ts";

describe("external runtime bridge", () => {
  test("executes HTTP external commands and queries with Forge auth and policy", async () => {
    const external = await startExternalHttpService();
    const { root, tenantA } = await scaffoldClientWorkspace("external-runtime", { generate: false });
    const manifestPath = writeExternalManifest(root, external.url);

    try {
      const imported = importExternalManifest(root, manifestPath);
      expect(imported.imported).toBe(true);
      expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);

      const generated = await runGenerateCommand(defaultGenerateOptions(root));
      expect(generated.exitCode).toBe(0);

      const policyRegistry = readJson<{
        commandAuth: Array<{ commandName: string; auth: { kind: string; policy?: string } }>;
        queryAuth: Array<{ queryName: string; auth: { kind: string; policy?: string } }>;
      }>(root, "src/forge/_generated/policyRegistry.json");
      expect(policyRegistry.commandAuth.find((entry) => entry.commandName === "billing.createInvoice")?.auth)
        .toEqual({ kind: "policy", policy: "billing.manage" });
      expect(policyRegistry.queryAuth.find((entry) => entry.queryName === "billing.listInvoices")?.auth)
        .toEqual({ kind: "policy", policy: "billing.manage" });

      const handle = await startClientDevServer(root, { db: "none" });
      try {
        const denied = await fetch(`${handle.url}/external/billing/commands/createInvoice`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forge-user-id": "u1",
            "x-forge-tenant-id": tenantA,
            "x-forge-role": "member",
          },
          body: JSON.stringify({ args: { title: "Denied" } }),
        });
        expect(denied.status).toBe(403);

        const { createForgeClient, api } = await import(`${root}/src/forge/_generated/client.ts`);
        const client = createForgeClient({
          url: handle.url,
          auth: { userId: "u1", tenantId: tenantA, role: "admin" },
        });

        const commandResult = await client.externalCommand(api.external.commands["billing.createInvoice"], {
          title: "Invoice",
        }) as { created: boolean; title: string; tenantHeader: string; authKind: string };
        expect(commandResult).toMatchObject({
          created: true,
          title: "Invoice",
          tenantHeader: tenantA,
          authKind: "user",
        });

        const queryResult = await client.externalQuery("billing.listInvoices", {}) as Array<{ id: string; tenant: string }>;
        expect(queryResult).toEqual([{ id: "inv_1", tenant: tenantA }]);
        expect(external.calls.map((call) => call.path)).toEqual([
          "/invoices/create",
          "/invoices/list",
        ]);
      } finally {
        handle.stop();
      }
    } finally {
      await external.stop();
      cleanupWorkspace(root);
    }
  });
});
