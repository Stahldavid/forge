import { describe, expect, test } from "bun:test";
import { importExternalManifest } from "../../src/forge/compiler/external-manifest/registry.ts";
import {
  cleanupWorkspace,
} from "../orchestrator/helpers.ts";
import {
  runForgeCli,
  scaffoldExternalRuntimeWorkspace,
  startExternalHttpService,
  writeExternalManifest,
  writeExternalRuntimeArtifacts,
} from "./external-runtime-helpers.ts";

describe("external runtime Node CLI bridge", () => {
  test("node bin/forge.mjs invokes an HTTP external command", async () => {
    const external = await startExternalHttpService();
    const { root, tenantId } = scaffoldExternalRuntimeWorkspace("external-runtime-node-cli");
    const manifestPath = writeExternalManifest(root, external.url);

    try {
      const imported = importExternalManifest(root, manifestPath);
      expect(imported.imported).toBe(true);
      expect(imported.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);

      writeExternalRuntimeArtifacts(root, imported.graph);

      const commandCli = await runForgeCli(root, [
        "run",
        "billing.createInvoice",
        "--args",
        JSON.stringify({ title: "Real CLI invoice" }),
        "--user-id",
        "u1",
        "--tenant-id",
        tenantId,
        "--role",
        "admin",
        "--json",
      ]);
      expect(commandCli.exitCode, commandCli.stderr).toBe(0);
      expect(JSON.parse(commandCli.stdout).run.result).toMatchObject({
        created: true,
        title: "Real CLI invoice",
        tenantHeader: tenantId,
      });
    } finally {
      await external.stop();
      cleanupWorkspace(root);
    }
  });
});
