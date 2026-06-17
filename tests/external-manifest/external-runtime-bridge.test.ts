import { describe, expect, test } from "bun:test";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runRunCommand } from "../../src/forge/cli/run.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { importExternalManifest } from "../../src/forge/compiler/external-manifest/registry.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
} from "../orchestrator/helpers.ts";
import {
  scaffoldClientWorkspace,
  startClientDevServer,
} from "../client/helpers.ts";

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(stripDeterministicHeader(readFileSync(join(root, relative), "utf8"))) as T;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function startExternalHttpService(): Promise<{
  url: string;
  stop: () => Promise<void>;
  calls: Array<{ path: string; body: unknown; headers: Record<string, string | string[] | undefined> }>;
}> {
  const calls: Array<{ path: string; body: unknown; headers: Record<string, string | string[] | undefined> }> = [];
  const server = createServer(async (request, response) => {
    const bodyText = await readBody(request);
    const body = bodyText ? JSON.parse(bodyText) : {};
    calls.push({
      path: request.url ?? "",
      body,
      headers: request.headers,
    });

    response.setHeader("content-type", "application/json");
    if (request.url === "/invoices/create") {
      response.end(JSON.stringify({
        ok: true,
        result: {
          created: true,
          title: body.args?.title,
          tenantHeader: request.headers["x-forge-tenant-id"],
          authKind: body.auth?.kind,
        },
      }));
      return;
    }

    if (request.url === "/invoices/list") {
      response.end(JSON.stringify({
        ok: true,
        result: [{ id: "inv_1", tenant: request.headers["x-forge-tenant-id"] }],
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "not found" } }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to start external service");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    calls,
    stop: () => new Promise((resolve, reject) => {
      (server as Server).close((error) => error ? reject(error) : resolve());
    }),
  };
}

function writeExternalManifest(root: string, baseUrl: string): string {
  const path = join(root, "billing.manifest.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        forgeProtocol: "1.0",
        language: "java",
        framework: "spring-boot",
        service: {
          name: "billing",
          transport: "http",
          baseUrl,
          health: "/health",
        },
        entries: [
          {
            name: "createInvoice",
            kind: "command",
            path: "/invoices/create",
            policy: "billing.manage",
            transaction: "external-managed",
            risk: "write",
            effects: ["invoice.created"],
          },
          {
            name: "listInvoices",
            kind: "query",
            path: "/invoices/list",
            policy: "billing.manage",
            transaction: "read-only",
            risk: "read",
            tenantScoped: true,
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

describe("external runtime bridge", () => {
  test("executes HTTP external commands and queries with Forge auth and policy", async () => {
    const external = await startExternalHttpService();
    const { root, tenantA } = await scaffoldClientWorkspace("external-runtime");
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

      const cliRun = await runRunCommand({
        name: "billing.createInvoice",
        list: false,
        json: true,
        mock: false,
        userId: "u1",
        tenantId: tenantA,
        role: "admin",
        args: { title: "CLI invoice" },
        workspaceRoot: root,
      });
      expect(cliRun.exitCode).toBe(0);
      expect(cliRun.run?.result).toMatchObject({
        created: true,
        title: "CLI invoice",
        tenantHeader: tenantA,
      });

      const handle = await startClientDevServer(root);
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
