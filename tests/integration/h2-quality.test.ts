import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkImportGuards } from "../../src/forge/compiler/guards/check-import-guards.ts";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { FORGE_GUARD_VIOLATION } from "../../src/forge/compiler/diagnostics/codes.ts";
import { buildRuntimeMatrix } from "../../src/forge/compiler/classifier/runtime-matrix.ts";
import { classify } from "../../src/forge/compiler/classifier/classify.ts";
import { resolveRecipe } from "../../src/forge/compiler/recipes/registry.ts";
import { makeExport, makePackageApi } from "../helpers/package-api.ts";
import {
  graphFromNodes,
  linkModules,
  makeModuleNode,
  stripeMatrix,
} from "../guards/helpers.ts";
import {
  cleanupWorkspace,
  createFixturePmAdapter,
  scaffoldAddWorkspace,
} from "./helpers.ts";

const GENERATED = "src/forge/_generated";

function readGenerated(workspace: string, relative: string): string {
  return readFileSync(join(workspace, relative), "utf8");
}

describe("H2 reference integration quality", () => {
  test("zod emits shared adapter with real zod re-export", async () => {
    const workspace = scaffoldAddWorkspace("h2-zod");
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

      const adapter = readGenerated(workspace, `${GENERATED}/packages/zod.shared.ts`);
      expect(adapter).toContain('import { z } from "zod"');
      expect(adapter).toContain("export const forgeZod = z");

      const doc = readGenerated(workspace, `${GENERATED}/docs/zod.md`);
      expect(doc).toContain("pure package reference");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("stripe emits server, workflow, webhook, and mock testkit", async () => {
    const workspace = scaffoldAddWorkspace("h2-stripe");
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

      expect(existsSync(join(workspace, GENERATED, "packages/stripe.server.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "packages/stripe.workflow.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "integrations/stripe/webhook.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "packages/stripe.command.ts"))).toBe(false);

      const server = readGenerated(workspace, `${GENERATED}/packages/stripe.server.ts`);
      expect(server).toContain("createStripeClient");
      expect(server).toContain("STRIPE_SECRET_KEY");

      const webhook = readGenerated(workspace, `${GENERATED}/integrations/stripe/webhook.ts`);
      expect(webhook).toContain("constructStripeWebhookEvent");
      expect(webhook).toContain("STRIPE_WEBHOOK_SECRET");

      const mock = readGenerated(workspace, `${GENERATED}/testkits/stripe.mock.ts`);
      expect(mock).toContain("createStripeMock");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("posthog emits client/server split and event/flag integrations", async () => {
    const workspace = scaffoldAddWorkspace("h2-posthog");
    try {
      await forgeAdd("posthog", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(existsSync(join(workspace, GENERATED, "packages/posthog.client.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "packages/posthog.server.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "integrations/posthog/events.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "integrations/posthog/flags.ts"))).toBe(true);

      const events = readGenerated(workspace, `${GENERATED}/integrations/posthog/events.ts`);
      expect(events).toContain("captureServerEvent");
      expect(events).toContain("captureClientEvent");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("sentry targets Next.js with errors, releases, and sourcemaps integrations", async () => {
    const workspace = scaffoldAddWorkspace("h2-sentry");
    try {
      await forgeAdd("sentry", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      const server = readGenerated(workspace, `${GENERATED}/packages/sentry.server.ts`);
      expect(server).toContain("@sentry/nextjs");
      expect(server).toContain("captureServerException");

      const sourcemaps = readGenerated(
        workspace,
        `${GENERATED}/integrations/sentry/sourcemaps.ts`,
      );
      expect(sourcemaps).toContain("SENTRY_AUTH_TOKEN");
      expect(sourcemaps).toContain("SENTRY_ORG");

      const doc = readGenerated(workspace, `${GENERATED}/docs/sentry.md`);
      expect(doc).toContain("nextjs");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("ai emits generations, evals, and provider modules", async () => {
    const workspace = scaffoldAddWorkspace("h2-ai");
    try {
      await forgeAdd("ai", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        pmAdapter: createFixturePmAdapter(),
      });

      expect(existsSync(join(workspace, GENERATED, "packages/ai.server.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "integrations/ai/generations.ts"))).toBe(true);
      expect(existsSync(join(workspace, GENERATED, "integrations/ai/evals.ts"))).toBe(true);
      expect(
        existsSync(join(workspace, GENERATED, "integrations/ai/providers/openai.ts")),
      ).toBe(true);
      expect(
        existsSync(join(workspace, GENERATED, "integrations/ai/providers/anthropic.ts")),
      ).toBe(true);

      const openai = readGenerated(
        workspace,
        `${GENERATED}/integrations/ai/providers/openai.ts`,
      );
      expect(openai).toContain("OPENAI_API_KEY");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("stripe guard matrix: action passes, command fails, transitive command fails", () => {
    const matrix = stripeMatrix();

    const actionModule = makeModuleNode("src/actions/checkout.ts", {
      declaredContexts: ["action"],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 1, end: 8 },
          importKind: "static",
        },
      ],
    });
    expect(checkImportGuards(graphFromNodes([actionModule]), matrix)).toHaveLength(0);

    const commandDirect = makeModuleNode("src/commands/pay.ts", {
      declaredContexts: ["command"],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 1, end: 8 },
          importKind: "static",
        },
      ],
    });
    const directViolations = checkImportGuards(graphFromNodes([commandDirect]), matrix);
    expect(directViolations.some((d) => d.code === FORGE_GUARD_VIOLATION)).toBe(true);

    const helper = makeModuleNode("src/lib/payments.ts", {
      declaredContexts: [],
      packageImports: [
        {
          specifier: "stripe",
          packageName: "stripe",
          subpath: "",
          span: { start: 1, end: 8 },
          importKind: "static",
        },
      ],
    });
    const commandTransitive = makeModuleNode("src/commands/charge.ts", {
      declaredContexts: ["command"],
    });
    linkModules(commandTransitive, helper);
    const transitiveViolations = checkImportGuards(
      graphFromNodes([commandTransitive, helper]),
      matrix,
    );
    expect(transitiveViolations.some((d) => d.code === FORGE_GUARD_VIOLATION)).toBe(true);
  });

  test("ai classified incompatible with command/query/liveQuery", () => {
    const api = makePackageApi({ name: "ai" });
    const result = classify(api, resolveRecipe("ai")!);
    expect(result.incompatible).toContain("command");
    expect(result.incompatible).toContain("query");
    expect(result.incompatible).toContain("liveQuery");
    expect(result.compatible).toContain("action");
    expect(result.compatible).toContain("workflow");
  });

  test("posthog-node incompatible with command in runtime matrix", () => {
    const api = makePackageApi({
      name: "posthog-node",
      entrypoints: [
        {
          subpath: ".",
          conditions: ["import", "types"],
          patternBacked: false,
          dtsPath: "index.d.ts",
          exports: [makeExport("PostHog", "class PostHog {}")],
        },
      ],
    });
    const matrix = buildRuntimeMatrix([
      {
        api,
        classification: classify(api, resolveRecipe("posthog")!),
        recipe: resolveRecipe("posthog")!,
      },
    ]);
    const entry = matrix.entries.find((e) => e.packageName === "posthog-node");
    expect(entry?.incompatible).toContain("command");
  });
});
