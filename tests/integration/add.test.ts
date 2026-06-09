import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { loadExistingForgeLock } from "../../src/forge/compiler/integration/plan.ts";
import { parseAdapterContext } from "../../src/forge/compiler/integration/render.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  createFailingPmAdapter,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "./helpers.ts";

describe("forge add integration", () => {
  test("rejects non-reference alias without changes", async () => {
    const workspace = scaffoldAddWorkspace("reject-alias");
    try {
      const result = await forgeAdd("unknown-pkg", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.errors[0]?.code).toBe("FORGE_UNKNOWN_ALIAS");
      expect(existsSync(join(workspace, "forge.lock"))).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds stripe with server adapter and names-only secrets", async () => {
    const workspace = scaffoldAddWorkspace("add-stripe");
    try {
      const result = await forgeAdd("stripe", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.server.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.command.ts"))).toBe(false);

      const lock = loadExistingForgeLock(workspace);
      expect(lock?.packages.some((entry) => entry.name === "stripe")).toBe(true);
      const stripeEntry = lock?.packages.find((entry) => entry.name === "stripe");
      expect(stripeEntry?.secrets.map((secret) => secret.envVar).sort()).toEqual([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]);
      expect(stripeEntry?.recipeVersion).toBe("1.0.0");
      expect(stripeEntry?.generatedFiles.every((path) => existsSync(join(workspace, path)))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds zod shared adapter for all contexts", async () => {
    const workspace = scaffoldAddWorkspace("add-zod");
    try {
      const result = await forgeAdd("zod", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/zod.shared.ts"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds posthog client and server adapters", async () => {
    const workspace = scaffoldAddWorkspace("add-posthog");
    try {
      const result = await forgeAdd("posthog", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/posthog.client.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/posthog.server.ts"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("dry-run reports would-change paths without writing", async () => {
    const workspace = scaffoldAddWorkspace("add-dry-run");
    try {
      const before = readFileSync(join(workspace, "package.json"), "utf8");
      const result = await forgeAdd("stripe", {
        workspaceRoot: workspace,
        json: false,
        dryRun: true,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.changed.length).toBeGreaterThan(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.server.ts"))).toBe(false);
      expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(before);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("rolls back snapshotted files on install failure", async () => {
    const workspace = scaffoldAddWorkspace("add-rollback");
    const originalPkg = readFileSync(join(workspace, "package.json"), "utf8");
    try {
      const result = await forgeAdd("stripe", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFailingPmAdapter(),
      });

      expect(result.exitCode).toBe(1);
      expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(originalPkg);
      expect(existsSync(join(workspace, "forge.lock"))).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("runtime matrix records stripe command incompatibility", async () => {
    const workspace = scaffoldAddWorkspace("add-matrix");
    try {
      await forgeAdd("stripe", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      const matrix = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src/forge/_generated/runtimeMatrix.json"), "utf8"),
        ),
      ) as { entries: Array<{ packageName: string; incompatible: string[] }> };

      const stripe = matrix.entries.find((entry) => entry.packageName === "stripe");
      expect(stripe?.incompatible).toContain("command");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adapter context parser recognizes runtime scopes", () => {
    expect(parseAdapterContext("stripe.server.ts")).toBe("server");
    expect(parseAdapterContext("zod.shared.ts")).toBe("shared");
    expect(parseAdapterContext("posthog.client.ts")).toBe("client");
  });
});
