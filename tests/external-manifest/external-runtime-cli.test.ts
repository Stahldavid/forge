import { describe, expect, test } from "bun:test";
import { runQueryCommand } from "../../src/forge/cli/query.ts";
import { runRunCommand } from "../../src/forge/cli/run.ts";
import { importExternalManifest } from "../../src/forge/compiler/external-manifest/registry.ts";
import {
  cleanupWorkspace,
} from "../orchestrator/helpers.ts";
import {
  scaffoldExternalRuntimeWorkspace,
  startExternalHttpService,
  writeExternalManifest,
  writeExternalRuntimeArtifacts,
} from "./external-runtime-helpers.ts";

describe("external runtime CLI bridge", () => {
  test("executes HTTP external entries through in-process run and query CLI paths", async () => {
    const external = await startExternalHttpService();
    const { root, tenantId } = scaffoldExternalRuntimeWorkspace("external-runtime-cli");
    const manifestPath = writeExternalManifest(root, external.url);

    try {
      const imported = importExternalManifest(root, manifestPath);
      expect(imported.imported).toBe(true);
      expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);

      writeExternalRuntimeArtifacts(root, imported.graph);

      const cliRun = await runRunCommand({
        name: "billing.createInvoice",
        list: false,
        json: true,
        mock: false,
        userId: "u1",
        tenantId,
        role: "admin",
        args: { title: "CLI invoice" },
        workspaceRoot: root,
      });
      expect(cliRun.exitCode).toBe(0);
      expect(cliRun.run?.result).toMatchObject({
        created: true,
        title: "CLI invoice",
        tenantHeader: tenantId,
      });

      const queryRun = await runQueryCommand({
        subcommand: "run",
        name: "billing.listInvoices",
        json: true,
        userId: "u1",
        tenantId,
        role: "admin",
        args: {},
        workspaceRoot: root,
      });
      expect(queryRun.exitCode).toBe(0);
      expect(queryRun.run?.result).toEqual([{ id: "inv_1", tenant: tenantId }]);
    } finally {
      await external.stop();
      cleanupWorkspace(root);
    }
  });
});
