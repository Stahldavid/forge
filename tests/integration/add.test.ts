import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { buildAddJson, writeHumanAdd } from "../../src/forge/cli/output.ts";
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
  async function captureConsole(fn: () => void): Promise<string> {
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = ((...args: unknown[]) => {
      lines.push(args.join(" "));
    }) as typeof console.log;
    try {
      fn();
    } finally {
      console.log = originalLog;
    }
    return `${lines.join("\n")}\n`;
  }

  test("rejects explicit non-reference integration alias without changes", async () => {
    const workspace = scaffoldAddWorkspace("reject-alias");
    try {
      const result = await forgeAdd("unknown-pkg", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.mode).toBe("integration");
      expect(result.targetKind).toBe("forge-integration");
      expect(result.explanation).toContain("No Forge integration recipe exists");
      expect(result.errors[0]?.code).toBe("FORGE_UNKNOWN_ALIAS");
      const json = buildAddJson(result);
      expect(json.nextActions as string[]).toContain("forge add package unknown-pkg --dry-run --json");
      expect(existsSync(join(workspace, "forge.lock"))).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds a generic npm package and regenerates package artifacts", async () => {
    const workspace = scaffoldAddWorkspace("add-package");
    try {
      const result = await forgeAdd("pattern-lib", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("package");
      expect(result.targetKind).toBe("npm-package");
      expect(result.target).toBe("root");
      expect(result.explanation).toContain("Adds npm package 'pattern-lib' to package.json");
      expect(result.changed).toContain("package.json");
      expect(existsSync(join(workspace, "src/forge/_generated/packageGraph.json"))).toBe(true);
      expect(readFileSync(join(workspace, "package.json"), "utf8")).toContain("pattern-lib");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds a generic package into a frontend workspace", async () => {
    const workspace = scaffoldAddWorkspace("add-package-web");
    let installCwd: string | undefined;
    mkdirSync(join(workspace, "web"), { recursive: true });
    writeFileSync(
      join(workspace, "web", "package.json"),
      JSON.stringify({ name: "web", private: true, type: "module", dependencies: {} }, null, 2),
      "utf8",
    );

    try {
      const result = await forgeAdd("runtime-lib", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "package",
        installWorkspace: "web",
        pmAdapter: createFixturePmAdapter((_spec, cwd) => {
          installCwd = cwd;
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("package");
      expect(result.target).toBe("web");
      expect(result.installWorkspace).toBe("web");
      expect(result.installCwd?.replace(/\\/g, "/")).toBe(join(workspace, "web").replace(/\\/g, "/"));
      expect(installCwd?.replace(/\\/g, "/")).toBe(join(workspace, "web").replace(/\\/g, "/"));
      expect(result.installCommand).not.toContain("--workspace");
      expect(result.changed).toContain("web/package.json");
      expect(readFileSync(join(workspace, "web", "package.json"), "utf8")).toContain("runtime-lib");
      expect(readFileSync(join(workspace, "package.json"), "utf8")).not.toContain("runtime-lib");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds frontend package through scoped alias and reports avoided native command", async () => {
    const workspace = scaffoldAddWorkspace("add-package-frontend-scope");
    mkdirSync(join(workspace, "web"), { recursive: true });
    writeFileSync(
      join(workspace, "web", "package.json"),
      JSON.stringify({ name: "web", private: true, type: "module", dependencies: {} }, null, 2),
      "utf8",
    );

    try {
      const result = await forgeAdd("frontend:lucide-react", {
        workspaceRoot: workspace,
        json: true,
        dryRun: true,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("package");
      expect(result.alias).toBe("lucide-react");
      expect(result.packageSpec).toBe("lucide-react");
      expect(result.packageTarget).toBe("frontend");
      expect(result.packageTargetReason).toContain("web/package.json");
      expect(result.target).toBe("web");
      expect(result.installWorkspace).toBe("web");
      expect(result.installCommand).toEqual([
        "npm",
        "install",
        "lucide-react",
        "--save",
        "--no-fund",
        "--no-audit",
        "--ignore-scripts",
      ]);
      expect(result.nativeInstallCommand).toEqual(result.installCommand);
      expect(result.avoidedManualCommand).toBe("npm install lucide-react --save --no-fund --no-audit --ignore-scripts");

      const json = buildAddJson(result);
      expect(json).toMatchObject({
        packageTarget: "frontend",
        avoidedManualCommand: "npm install lucide-react --save --no-fund --no-audit --ignore-scripts",
      });
      const human = await captureConsole(() => writeHumanAdd(result));
      expect(human).toContain("package target: frontend");
      expect(human).toContain("manual command avoided: npm install lucide-react");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds backend package through target flag into the root package", async () => {
    const workspace = scaffoldAddWorkspace("add-package-backend-flag");
    try {
      const result = await forgeAdd("hono", {
        workspaceRoot: workspace,
        json: true,
        dryRun: true,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "auto",
        packageTarget: "backend",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("package");
      expect(result.target).toBe("root");
      expect(result.packageTarget).toBe("backend");
      expect(result.packageTargetReason).toContain("root package.json");
      expect(result.installWorkspace).toBeUndefined();
      expect(result.changed).toContain("package.json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("frontend package target fails with actionable message when no frontend package exists", async () => {
    const workspace = scaffoldAddWorkspace("add-package-frontend-missing");
    try {
      const result = await forgeAdd("frontend:lucide-react", {
        workspaceRoot: workspace,
        json: true,
        dryRun: true,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(1);
      expect(result.mode).toBe("package");
      expect(result.packageTarget).toBe("frontend");
      expect(result.errors[0]?.code).toBe("FORGE_ADD_FRONTEND_WORKSPACE_MISSING");
      expect(result.errors[0]?.suggestedCommands).toContain("forge make ui --framework vite --dry-run --json");
      expect(result.changed).toEqual([]);
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
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("integration");
      expect(result.targetKind).toBe("forge-integration");
      expect(result.explanation).toContain("Applies the Forge integration recipe 'stripe'");
      expect(result.recipeVersion).toBe("2.0.0");
      expect(result.recipePackages).toEqual(["stripe"]);
      expect(result.requiredSecrets?.sort()).toEqual([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]);
      expect(result.optionalSecrets).toEqual([]);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.server.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.command.ts"))).toBe(false);

      const lock = loadExistingForgeLock(workspace);
      expect(lock?.packages.some((entry) => entry.name === "stripe")).toBe(true);
      const stripeEntry = lock?.packages.find((entry) => entry.name === "stripe");
      expect(stripeEntry?.secrets.map((secret) => secret.envVar).sort()).toEqual([
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
      ]);
      expect(stripeEntry?.recipeVersion).toBe("2.0.0");
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.workflow.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/integrations/stripe/webhook.ts"))).toBe(true);
      expect(stripeEntry?.generatedFiles.every((path) => existsSync(join(workspace, path)))).toBe(true);
      const json = buildAddJson(result);
      expect(json).toMatchObject({
        targetKind: "forge-integration",
        recipePackages: ["stripe"],
        requiredSecrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
      });
      expect(json.nextActions as string[]).toContain("forge deps inspect stripe --json");
      expect(json.nextActions as string[]).toContain("forge secrets check --json");
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
        mode: "auto",
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
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/posthog.client.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/posthog.server.ts"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds convex as an app-contract package recipe", async () => {
    const workspace = scaffoldAddWorkspace("add-convex");
    try {
      const result = await forgeAdd("convex", {
        workspaceRoot: workspace,
        json: false,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("integration");
      expect(result.recipeVersion).toBe("1.0.0");
      expect(result.recipePackages).toEqual(["convex"]);
      expect(result.requiredSecrets).toEqual([]);
      expect(result.optionalSecrets?.sort()).toEqual([
        "CONVEX_DEPLOYMENT",
        "CONVEX_DEPLOY_KEY",
        "CONVEX_URL",
        "NEXT_PUBLIC_CONVEX_URL",
      ]);
      expect(existsSync(join(workspace, "src/forge/_generated/docs/convex.md"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/testkits/convex.mock.ts"))).toBe(true);
      expect(readFileSync(join(workspace, "src/forge/_generated/docs/convex.md"), "utf8")).toContain(
        "Convex is treated as an agent-friendly backend package",
      );

      const matrix = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src/forge/_generated/runtimeMatrix.json"), "utf8"),
        ),
      ) as { entries: Array<{ packageName: string; incompatible: string[]; compatible: string[] }> };
      const convex = matrix.entries.find((entry) => entry.packageName === "convex");
      expect(convex?.compatible).toContain("client");
      expect(convex?.compatible).toContain("server");
      expect(convex?.incompatible).toContain("command");
      expect(convex?.incompatible).toContain("query");
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
        mode: "auto",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.changed.length).toBeGreaterThan(0);
      expect(existsSync(join(workspace, "src/forge/_generated/packages/stripe.server.ts"))).toBe(false);
      expect(readFileSync(join(workspace, "package.json"), "utf8")).toBe(before);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("package dry-run exposes install plan and package-oriented next actions", async () => {
    const workspace = scaffoldAddWorkspace("add-package-plan");
    try {
      const result = await forgeAdd("@tanstack/react-query@latest", {
        workspaceRoot: workspace,
        json: true,
        dryRun: true,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "package",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("package");
      expect(result.packageSpec).toBe("@tanstack/react-query@latest");
      expect(result.packageName).toBe("@tanstack/react-query");
      expect(result.packageManager).toBe("npm");
      expect(result.installCommand).toEqual([
        "npm",
        "install",
        "@tanstack/react-query@latest",
        "--save",
        "--no-fund",
        "--no-audit",
        "--ignore-scripts",
      ]);
      expect(result.installCwd?.replace(/\\/g, "/")).toBe(workspace.replace(/\\/g, "/"));

      const json = buildAddJson(result);
      expect(json).toMatchObject({
        mode: "package",
        targetKind: "npm-package",
        packageSpec: "@tanstack/react-query@latest",
        packageName: "@tanstack/react-query",
        packageManager: "npm",
        packageTarget: "root",
        avoidedManualCommand: "npm install @tanstack/react-query@latest --save --no-fund --no-audit --ignore-scripts",
      });
      expect(String(json.explanation)).toContain("Forge runs the native install command for you: npm install @tanstack/react-query@latest");
      expect(json.nextActions as string[]).toContain("forge deps inspect @tanstack/react-query --json");
      expect(json.nextActions as string[]).not.toContain("forge deps inspect @tanstack/react-query@latest --json");
      expect(json.nextActions as string[]).toContain("forge check --json");

      const human = await captureConsole(() => writeHumanAdd(result));
      expect(human).toContain("package spec: @tanstack/react-query@latest");
      expect(human).toContain("package name: @tanstack/react-query");
      expect(human).toContain("package target: root");
      expect(human).toContain(`install cwd: ${workspace.replace(/\\/g, "/")}`);
      expect(human).toContain("install command: npm install @tanstack/react-query@latest");
      expect(human).toContain("manual command avoided: npm install @tanstack/react-query@latest");
      expect(human).toContain("Next:");
      expect(human).toContain("forge deps inspect @tanstack/react-query --json");
      expect(human).toContain("forge check --json");
      expect(human).not.toContain("forge deps inspect @tanstack/react-query@latest --json");
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
        mode: "auto",
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
        mode: "auto",
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
