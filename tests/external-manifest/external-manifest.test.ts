import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  importExternalManifest,
  readExternalManifestFile,
} from "../../src/forge/compiler/external-manifest/registry.ts";
import { validateExternalManifest } from "../../src/forge/compiler/external-manifest/validate.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

const GENERATED = "src/forge/_generated";

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(stripDeterministicHeader(readFileSync(join(root, relative), "utf8"))) as T;
}

function writeManifest(root: string): string {
  const path = join(root, "java-service.manifest.json");
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
          baseUrl: "http://localhost:8080",
          health: "/actuator/health",
        },
        entries: [
          {
            name: "createInvoice",
            kind: "command",
            path: "/invoices",
            policy: "billing.write",
            transaction: "external-managed",
            risk: "write",
            needsApproval: true,
            effects: ["invoice.created"],
            inputSchema: {
              type: "object",
              required: ["customerId"],
              properties: {
                customerId: { type: "string" },
              },
            },
          },
          {
            name: "listInvoices",
            kind: "query",
            path: "/invoices",
            policy: "billing.read",
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

describe("external Forge manifests", () => {
  test("rejects transport manifests missing required connection fields", () => {
    const baseManifest = {
      forgeProtocol: "1.0",
      language: "node",
      service: {
        name: "billing",
      },
      entries: [
        {
          name: "listInvoices",
          kind: "query",
        },
      ],
    };

    const http = validateExternalManifest({
      ...baseManifest,
      service: { ...baseManifest.service, transport: "http" },
    });
    expect(http.manifest).toBeNull();
    expect(http.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_EXTERNAL_SERVICE_BASE_URL")).toBe(true);

    const stdio = validateExternalManifest({
      ...baseManifest,
      service: { ...baseManifest.service, transport: "stdio" },
    });
    expect(stdio.manifest).toBeNull();
    expect(stdio.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_EXTERNAL_SERVICE_COMMAND")).toBe(true);

    const structuredStdio = validateExternalManifest({
      ...baseManifest,
      service: { ...baseManifest.service, transport: "stdio", commandArgs: ["node", "adapter.js", ""] },
    });
    expect(structuredStdio.manifest?.service.commandArgs).toEqual(["node", "adapter.js", ""]);

    const invalidStructuredStdio = validateExternalManifest({
      ...baseManifest,
      service: { ...baseManifest.service, transport: "stdio", commandArgs: [] },
    });
    expect(invalidStructuredStdio.manifest).toBeNull();
    expect(invalidStructuredStdio.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_EXTERNAL_SERVICE_COMMAND_ARGS")).toBe(true);
  });

  test("validates, imports, and exposes external services in generated contracts", async () => {
    const workspace = scaffoldGenerateWorkspace("external-manifest");
    try {
      mkdirSync(join(workspace, ".forge"), { recursive: true });
      const manifestPath = writeManifest(workspace);

      const validation = readExternalManifestFile(manifestPath);
      expect(validation.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);
      expect(validation.manifest?.service.name).toBe("billing");

      const imported = importExternalManifest(workspace, manifestPath);
      expect(imported.imported).toBe(true);
      expect(imported.graph.services).toHaveLength(1);

      const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const external = readJson<{
        services: Array<{ name: string; language: string; entries: Array<{ name: string; kind: string; needsApproval?: boolean }> }>;
        diagnostics: unknown[];
      }>(workspace, `${GENERATED}/externalServices.json`);
      expect(external.diagnostics).toHaveLength(0);
      expect(external.services[0]).toMatchObject({
        name: "billing",
        language: "java",
      });

      const api = readJson<{
        external: {
          services: Record<string, string>;
          commands: Record<string, { language: string; service: string }>;
          queries: Record<string, { language: string; service: string }>;
        };
      }>(workspace, `${GENERATED}/api.json`);
      expect(api.external.services.billing).toBe("billing");
      expect(api.external.commands["billing.createInvoice"]).toMatchObject({
        service: "billing",
        language: "java",
      });
      expect(api.external.queries["billing.listInvoices"]).toMatchObject({
        service: "billing",
        language: "java",
      });

      const contract = readJson<{
        externalServices: Array<{ name: string; language: string; commands: string[]; queries: string[] }>;
        commands: Array<{ name: string; source?: string; external?: { service: string; language: string } }>;
        queries: Array<{ name: string; source?: string; external?: { service: string; language: string } }>;
      }>(workspace, `${GENERATED}/agentContract.json`);
      expect(contract.externalServices[0]).toMatchObject({
        name: "billing",
        language: "java",
        commands: ["billing.createInvoice"],
        queries: ["billing.listInvoices"],
      });
      expect(contract.commands.find((command) => command.name === "billing.createInvoice")).toMatchObject({
        source: "external",
        external: { service: "billing", language: "java", needsApproval: true },
      });
      expect(contract.queries.find((query) => query.name === "billing.listInvoices")).toMatchObject({
        source: "external",
        external: { service: "billing", language: "java" },
      });

      const tools = readJson<{
        autoTools: Array<{ sourceName: string; execution: string; source?: string; needsApproval: boolean }>;
      }>(workspace, `${GENERATED}/agentTools.json`);
      expect(tools.autoTools.find((tool) => tool.sourceName === "billing.createInvoice")).toMatchObject({
        source: "external",
        execution: "external-runtime-endpoint",
        needsApproval: true,
      });
      expect(tools.autoTools.find((tool) => tool.sourceName === "billing.listInvoices")).toMatchObject({
        source: "external",
        execution: "external-runtime-endpoint",
        needsApproval: false,
      });

      const inspected = await runInspectCommand("external", workspace);
      expect(inspected.exitCode).toBe(0);
      expect((inspected.data as { services: unknown[] }).services).toHaveLength(1);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
