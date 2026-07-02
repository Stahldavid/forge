import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { forgeAdd } from "../../src/forge/compiler/integration/add.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { buildAddJson, writeHumanAdd } from "../../src/forge/cli/output.ts";
import { runAuthCommand } from "../../src/forge/cli/auth.ts";
import { loadExistingForgeLock } from "../../src/forge/compiler/integration/plan.ts";
import { parseAdapterContext } from "../../src/forge/compiler/integration/render.ts";
import { renderWorkosSeedYaml } from "../../src/forge/compiler/integration/templates/workos.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { mapClaimsToAuthContext } from "../../src/forge/runtime/auth/claims.ts";
import { defaultGenerateOptions } from "../orchestrator/helpers.ts";
import {
  cleanupWorkspace,
  createFailingPmAdapter,
  createFixturePmAdapter,
  seedInstalledPackage,
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
      expect((json.nextActions as string[]).indexOf("forge generate")).toBeLessThan(
        (json.nextActions as string[]).indexOf("forge deps inspect stripe --json"),
      );
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
      mkdirSync(join(workspace, "src/forge/_generated/docs"), { recursive: true });
      writeFileSync(
        join(workspace, "src/forge/_generated/docs/AGENTS.md"),
        "# Existing generated doc\n",
        "utf8",
      );

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
      expect(result.changed).toContain("package.json");
      expect(result.requiredSecrets).toEqual([]);
      expect(result.optionalSecrets?.sort()).toEqual([
        "CONVEX_DEPLOYMENT",
        "CONVEX_DEPLOY_KEY",
        "CONVEX_URL",
        "NEXT_PUBLIC_CONVEX_URL",
      ]);
      expect(existsSync(join(workspace, "src/forge/_generated/docs/convex.md"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/testkits/convex.mock.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/docs/AGENTS.md"))).toBe(true);
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

      const json = buildAddJson(result);
      expect((json.nextActions as string[]).indexOf("forge generate")).toBeLessThan(
        (json.nextActions as string[]).indexOf("forge deps inspect convex --json"),
      );

      const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);
      const checked = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds workos auth adapter with AuthKit, RBAC seed, and tenant claims by default", async () => {
    const workspace = scaffoldAddWorkspace("add-workos");
    try {
      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.mode).toBe("integration");
      expect(result.recipeVersion).toBe("1.0.0");
      expect(result.recipePackages).toEqual(["@workos-inc/node"]);
      expect(result.requiredSecrets?.sort()).toEqual([
        "WORKOS_API_KEY",
        "WORKOS_CLIENT_ID",
        "WORKOS_COOKIE_PASSWORD",
      ]);
      expect(result.optionalSecrets?.sort()).toEqual([
        "WORKOS_REDIRECT_URI",
        "WORKOS_WEBHOOK_SECRET",
      ]);

      const expectedFiles = [
        "src/forge/_generated/packages/workos.server.ts",
        "src/forge/_generated/integrations/workos/auth-routes.ts",
        "src/forge/_generated/integrations/workos/authkit.ts",
        "src/forge/_generated/integrations/workos/http-handler.ts",
        "src/forge/_generated/integrations/workos/seed.ts",
        "src/forge/_generated/integrations/workos/session.ts",
        "src/forge/_generated/integrations/workos/webhook.ts",
        "src/forge/_generated/integrations/workos/workos-seed.yml",
        "workos-seed.yml",
        "src/forge/_generated/testkits/workos.mock.ts",
        "src/forge/_generated/docs/workos.md",
        ".env.example",
        "src/policies.workos.ts",
      ];
      for (const file of expectedFiles) {
        expect(existsSync(join(workspace, file))).toBe(true);
      }

      expect(readFileSync(join(workspace, "src/forge/_generated/packages/workos.server.ts"), "utf8")).toContain(
        "createForgeWorkOS",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/packages/workos.server.ts"), "utf8")).toContain(
        "createWorkOS({",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/packages/workos.server.ts"), "utf8")).toContain(
        'clientId: secrets.get("WORKOS_CLIENT_ID")',
      );
      const rootSeed = readFileSync(join(workspace, "workos-seed.yml"), "utf8");
      const generatedSeed = readFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/workos-seed.yml"),
        "utf8",
      );
      expect(rootSeed.startsWith("// @forge-generated")).toBe(false);
      expect(generatedSeed.startsWith("// @forge-generated")).toBe(false);
      expect(rootSeed).toContain(
        "permissions:",
      );
      expect(rootSeed).toContain(
        "organizations:",
      );
      expect(rootSeed).toContain(
        "Acme Corp",
      );
      expect(rootSeed).toContain(
        "Globex",
      );
      expect(rootSeed).toContain(
        "webhook_endpoints:",
      );
      expect(rootSeed).not.toContain("resource_types:");
      expect(existsSync(join(workspace, "src/forge/_generated/integrations/workos/fga.ts"))).toBe(false);
      expect(existsSync(join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"))).toBe(false);
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"), "utf8")).toContain(
        "handleWorkOSAuthRequest",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"), "utf8")).toContain(
        "/callback",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/session.ts"), "utf8")).toContain(
        "workOSSessionToClaims",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"), "utf8")).toContain(
        "verifyWorkOSWebhook",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"), "utf8")).toContain(
        'provider: "workos"',
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"), "utf8")).toContain(
        "handleWorkOSWebhook",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"), "utf8")).toContain(
        "handleWorkOSWebhookRequest",
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"), "utf8")).toContain(
        "/webhooks/workos",
      );
      expect(readFileSync(join(workspace, ".env.example"), "utf8")).toContain("FORGE_AUTH_MODE=oidc");
      expect(readFileSync(join(workspace, ".env.example"), "utf8")).toContain("WORKOS_WEBHOOK_SECRET=");
      expect(readFileSync(join(workspace, "src/policies.workos.ts"), "utf8")).toContain(
        '"invitations.create": canPermission("invitations:create")',
      );
      expect(readFileSync(join(workspace, "src/forge/_generated/docs/workos.md"), "utf8")).toContain(
        "WorkOS is the preferred ForgeOS auth adapter",
      );

      const json = buildAddJson(result);
      expect(json).toMatchObject({
        alias: "workos",
        targetKind: "forge-integration",
        recipePackages: ["@workos-inc/node"],
      });
      expect(json.nextActions as string[]).toContain("forge workos install --json");
      expect(json.nextActions as string[]).toContain("forge workos install --yes --json");
      expect(json.nextActions as string[]).toContain("forge workos doctor --yes --json");
      expect(json.nextActions as string[]).toContain(
        "forge workos seed --file workos-seed.yml --dry-run --json",
      );
      expect(json.nextActions as string[]).toContain(
        "forge workos seed --file workos-seed.yml --json",
      );
      expect(json.nextActions as string[]).toContain("forge workos prove --file workos-seed.yml --json");

      const matrix = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src/forge/_generated/runtimeMatrix.json"), "utf8"),
        ),
      ) as { entries: Array<{ packageName: string; incompatible: string[]; compatible: string[] }> };
      const workos = matrix.entries.find((entry) => entry.packageName === "@workos-inc/node");
      expect(workos?.compatible).toContain("server");
      expect(workos?.compatible).toContain("endpoint");
      expect(workos?.incompatible).toContain("command");
      expect(workos?.incompatible).toContain("query");

      const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);
      const authRegistry = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src/forge/_generated/authRegistry.json"), "utf8"),
        ),
      ) as { claims: { tenantId?: string; userId: string; email?: string; permissions?: string } };
      expect(authRegistry.claims).toMatchObject({
        userId: "sub",
        email: "email",
        tenantId: "organization_id",
        permissions: "permissions",
      });
      const acmeAuth = mapClaimsToAuthContext(
        {
          sub: "user_1",
          email: "owner@acme.test",
          organization_id: "org_acme",
          role: "owner",
          permissions: ["onboarding:read", "invitations:create"],
        },
        {
          mode: "oidc",
          algorithms: ["RS256"],
          claims: authRegistry.claims,
          requiresTenant: true,
        },
        { authProvider: "oidc" },
      );
      const globexAuth = mapClaimsToAuthContext(
        {
          sub: "user_2",
          email: "member@globex.test",
          organization_id: "org_globex",
          role: "member",
          permissions: ["onboarding:read", "tasks:update"],
        },
        {
          mode: "oidc",
          algorithms: ["RS256"],
          claims: authRegistry.claims,
          requiresTenant: true,
        },
        { authProvider: "oidc" },
      );
      expect(acmeAuth.kind).toBe("user");
      expect(globexAuth.kind).toBe("user");
      if (acmeAuth.kind === "user" && globexAuth.kind === "user") {
        expect(acmeAuth.tenantId).toBe("org_acme");
        expect(globexAuth.tenantId).toBe("org_globex");
        expect(acmeAuth.tenantId).not.toBe(globexAuth.tenantId);
        expect(acmeAuth.permissions).toContain("invitations:create");
        expect(globexAuth.permissions).not.toContain("invitations:create");
      }
      const checked = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(0);
      const authProof = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
      });
      expect(authProof.exitCode).toBe(0);
      expect(authProof.data).toMatchObject({
        kind: "auth-proof",
        workos: {
          detected: true,
          requiredSecretsRegistered: true,
          webhookSecretRegistered: true,
        },
      });
      expect(JSON.stringify(authProof.data)).toContain("INV-WORKOS-001");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds optional WorkOS FGA artifacts with --with-fga", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-with-fga");
    try {
      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        withFga: true,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "src/forge/_generated/integrations/workos/fga.ts"))).toBe(true);
      expect(existsSync(join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"))).toBe(true);
      const rootSeed = readFileSync(join(workspace, "workos-seed.yml"), "utf8");
      expect(rootSeed).toContain("resource_types:");
      const resourceMapSource = readFileSync(join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"), "utf8");
      expect(resourceMapSource).toContain("canWorkOS");
      expect(resourceMapSource).toContain("assertWorkOSResourceTenant");
      expect(resourceMapSource).toContain("FORGE_WORKOS_CROSS_TENANT_RESOURCE");
      for (const kind of ["organization", "project", "team", "taskGroup", "task"]) {
        expect(resourceMapSource).toContain(`"${kind}"`);
      }

      const resourceMap = await import(
        pathToFileURL(join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts")).href
      ) as {
        buildOnboardingResourceGraph(input: { organizationId: string; projects?: string[] }): {
          organization: unknown;
          projects: unknown[];
        };
        workosResource(kind: "organization", id: string): unknown;
        assertWorkOSResourceTenant(input: { resource: unknown; organization: unknown }): void;
        syncWorkOSResourceGraph(input: {
          client: unknown;
          organizationId: string;
          graph: unknown;
          mode?: "create" | "upsert";
          telemetry?: { emit(event: string, properties: Record<string, unknown>): void };
        }): Promise<{ synced: number; records: unknown[] }>;
        canWorkOS(input: {
          client: unknown;
          organizationMembershipId: string;
          permission: string;
          resource: unknown;
          organization?: unknown;
          cache?: unknown;
          telemetry?: { emit(event: string, properties: Record<string, unknown>): void };
        }): Promise<boolean>;
        ForgeWorkOSFgaDecisionCache: new (ttlMs?: number) => unknown;
      };
      const testkit = await import(
        pathToFileURL(join(workspace, "src/forge/_generated/testkits/workos.mock.ts")).href
      ) as {
        createWorkOSMock(): {
          getResources(): unknown[];
          getAccessChecks(): Array<{ organizationMembershipId: string; authorized: boolean; reason: string }>;
        };
      };
      const acmeGraph = resourceMap.buildOnboardingResourceGraph({
        organizationId: "org_acme",
        projects: ["onboarding"],
      });
      const globexOrganization = resourceMap.workosResource("organization", "org_globex");
      expect(() =>
        resourceMap.assertWorkOSResourceTenant({
          resource: acmeGraph.projects[0],
          organization: acmeGraph.organization,
        }),
      ).not.toThrow();
      expect(() =>
        resourceMap.assertWorkOSResourceTenant({
          resource: acmeGraph.projects[0],
          organization: globexOrganization,
        }),
      ).toThrow("FORGE_WORKOS_CROSS_TENANT_RESOURCE");
      const workosMock = testkit.createWorkOSMock();
      const telemetryEvents: string[] = [];
      const sync = await resourceMap.syncWorkOSResourceGraph({
        client: workosMock,
        organizationId: "org_acme",
        graph: acmeGraph,
        mode: "upsert",
        telemetry: { emit: (event) => telemetryEvents.push(event) },
      });
      expect(sync.synced).toBe(1);
      expect(sync.records).toHaveLength(1);
      expect(workosMock.getResources()).toHaveLength(1);
      expect(telemetryEvents).toContain("forge.workos.fga.resource.created");
      const decisionCache = new resourceMap.ForgeWorkOSFgaDecisionCache(60_000);
      await expect(resourceMap.canWorkOS({
        client: workosMock,
        organizationMembershipId: "om_acme_owner",
        permission: "invitations:create",
        resource: acmeGraph.projects[0],
        organization: acmeGraph.organization,
        cache: decisionCache,
      })).resolves.toBe(true);
      await expect(resourceMap.canWorkOS({
        client: workosMock,
        organizationMembershipId: "om_globex_member",
        permission: "invitations:create",
        resource: acmeGraph.projects[0],
        organization: acmeGraph.organization,
      })).resolves.toBe(false);
      expect(workosMock.getAccessChecks()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ organizationMembershipId: "om_acme_owner", authorized: true }),
          expect.objectContaining({ organizationMembershipId: "om_globex_member", authorized: false, reason: "cross_tenant" }),
        ]),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("workos seed generation preserves inferred FGA parent resources", () => {
    const seed = renderWorkosSeedYaml({
      alias: "workos",
      packageName: "@workos-inc/node",
      packageNames: ["@workos-inc/node"],
      context: "server",
      compatible: ["server"],
      incompatible: [],
      secrets: [],
      recipe: {
        alias: "workos",
        packageName: "@workos-inc/node",
        category: "auth",
        contexts: ["server"],
        integrations: ["workos/fga.ts", "workos/resource-map.ts"],
      },
      appGraph: {
        schemaVersion: "0.1.0",
        generatorVersion: "0.1.0",
        analyzerVersion: "test",
        inputHash: "test",
        symbols: [
          {
            id: "table:vendors",
            kind: "schema.table",
            name: "vendors",
            qualifiedName: "vendors",
            file: "src/forge/schema.ts",
            span: { start: 0, end: 0 },
            meta: {
              sourceSlice: 'export const vendors = defineTable("vendors", { tenantId: "text", name: "text" });',
            },
          },
          {
            id: "table:accessRequests",
            kind: "schema.table",
            name: "accessRequests",
            qualifiedName: "accessRequests",
            file: "src/forge/schema.ts",
            span: { start: 0, end: 0 },
            meta: {
              sourceSlice: 'export const accessRequests = defineTable("accessRequests", { tenantId: "text", vendorId: "text", status: "text" });',
            },
          },
          {
            id: "policy:access",
            kind: "permissions",
            name: "access.approve",
            qualifiedName: "access.approve",
            file: "src/policies.ts",
            span: { start: 0, end: 0 },
            meta: { sourceSlice: 'canPermission("access:approve")' },
          },
        ],
        edges: [],
        diagnostics: [],
      },
    } as unknown as Parameters<typeof renderWorkosSeedYaml>[0]);

    expect(seed).toContain("  - slug: 'accessRequest'");
    expect(seed).toContain("    parent: 'vendor'");
    expect(seed).toContain("  - slug: 'vendor'");
    expect(seed).toContain("    parent: 'organization'");
  });

  test("adds WorkOS AuthKit React bridge when a web workspace exists", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-web");
    try {
      mkdirSync(join(workspace, "web", "src", "lib"), { recursive: true });
      writeFileSync(
        join(workspace, "web", "package.json"),
        JSON.stringify(
          {
            name: "forge-web",
            private: true,
            type: "module",
            dependencies: {
              react: "^19.0.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "lib", "forge.ts"),
        "export const forgeUrl = 'http://127.0.0.1:3765';\nexport function ForgeProvider(props: { children: unknown }) { return props.children; }\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "main.tsx"),
        [
          'import { StrictMode } from "react";',
          'import { createRoot } from "react-dom/client";',
          'import { App } from "./App";',
          'import { ForgeProvider, forgeUrl } from "./lib/forge";',
          'import "./styles.css";',
          "",
          'createRoot(document.getElementById("root")!).render(',
          "  <StrictMode>",
          "    <ForgeProvider url={forgeUrl} devAuth>",
          "      <App />",
          "    </ForgeProvider>",
          "  </StrictMode>,",
          ");",
          "",
        ].join("\n"),
        "utf8",
      );

      const addCalls: Array<{ spec: string; cwd: string }> = [];
      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter((spec, cwd) => addCalls.push({ spec, cwd })),
      });

      expect(result.exitCode).toBe(0);
      expect(addCalls).toContainEqual({ spec: "@workos-inc/node", cwd: workspace });
      expect(addCalls).toContainEqual({ spec: "@workos-inc/authkit-react", cwd: join(workspace, "web") });
      expect(result.changed).toContain("web/package.json");
      expect(result.changed).toContain("web/src/lib/workos-auth.tsx");
      expect(result.changed).toContain("web/src/main.tsx");

      const webPkg = JSON.parse(readFileSync(join(workspace, "web", "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(webPkg.dependencies?.["@workos-inc/authkit-react"]).toBe("^1.0.0");
      const bridge = readFileSync(join(workspace, "web/src/lib/workos-auth.tsx"), "utf8");
      expect(bridge).toContain("AuthKitProvider");
      expect(bridge).toContain("getAccessToken");
      expect(bridge).toContain("useForgeWorkOSSession");
      expect(bridge).toContain("fetch('/session'");
      expect(bridge).toContain("ForgeProvider");
      expect(bridge).toContain("url={forgeUrl}");
      const main = readFileSync(join(workspace, "web/src/main.tsx"), "utf8");
      expect(main).toContain('import { ForgeWorkOSAuthProvider } from "./lib/workos-auth";');
      expect(main).toContain("<ForgeWorkOSAuthProvider>");
      expect(main).not.toContain("devAuth");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds WorkOS AuthKit provider around the vendor-access custom root", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-vendor-access-web");
    try {
      mkdirSync(join(workspace, "web", "src", "lib"), { recursive: true });
      writeFileSync(
        join(workspace, "web", "package.json"),
        JSON.stringify({ name: "forge-vendor-web", private: true, type: "module", dependencies: { react: "^19.0.0" } }, null, 2),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "lib", "forge.ts"),
        "export const forgeUrl = ''; export function ForgeProvider(props: { children: unknown }) { return props.children; }\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "main.tsx"),
        [
          'import { FormEvent, StrictMode, type ReactNode, useState } from "react";',
          'import { createRoot } from "react-dom/client";',
          'import { App, type LocalPersona } from "./App";',
          'import { ForgeProvider, forgeUrl } from "./lib/forge";',
          "",
          "const personas: LocalPersona[] = [];",
          "function Root() {",
          "  const [signedInPersonaId, setSignedInPersonaId] = useState<string | null>(null);",
          "  const signedInPersona = { email: 'riley@acme.example', organizationId: 'org_acme', role: 'owner', permissions: [] } as LocalPersona;",
          "  if (!signedInPersonaId) return <main>Sign in</main>;",
          "  return (",
          "    <LocalForgeProvider persona={signedInPersona}>",
          "      <App",
          "        persona={signedInPersona}",
          "        personas={personas}",
          "        onPersonaChange={() => undefined}",
          "        onSignOut={() => setSignedInPersonaId(null)}",
          "      />",
          "    </LocalForgeProvider>",
          "  );",
          "}",
          "function LocalForgeProvider({ persona, children }: { persona: LocalPersona; children: ReactNode }) {",
          "  return <ForgeProvider url={forgeUrl} devAuth={{ userId: persona.email }}>{children}</ForgeProvider>;",
          "}",
          'createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);',
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.changed).toContain("web/src/main.tsx");
      const main = readFileSync(join(workspace, "web/src/main.tsx"), "utf8");
      expect(main).toContain('import { ForgeWorkOSAuthProvider, hasWorkOSBrowserConfig, useForgeWorkOSSession, useWorkOSAuth } from "./lib/workos-auth";');
      expect(main).toContain("const app = (");
      expect(main).toContain("<ForgeWorkOSAuthProvider>{app}</ForgeWorkOSAuthProvider>");
      expect(main).toContain("<LocalForgeProvider persona={signedInPersona}>{app}</LocalForgeProvider>");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("adds WorkOS AuthKit root before vendor-access local identity login", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-vendor-access-login");
    try {
      mkdirSync(join(workspace, "web", "src", "lib"), { recursive: true });
      writeFileSync(
        join(workspace, "web", "package.json"),
        JSON.stringify({ name: "forge-vendor-web", private: true, type: "module", dependencies: { react: "^19.0.0" } }, null, 2),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "lib", "forge.ts"),
        "export const forgeUrl = ''; export function ForgeProvider(props: { children: unknown }) { return props.children; }\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "main.tsx"),
        [
          'import { StrictMode, type ReactNode, useMemo, useState } from "react";',
          'import { createRoot } from "react-dom/client";',
          'import { App, type LocalPersona } from "./App";',
          'import { ForgeProvider, forgeUrl } from "./lib/forge";',
          "",
          "const personas: LocalPersona[] = [];",
          "function Root() {",
          "  const [personaId, setPersonaId] = useState('acme-owner');",
          "  const [signedInPersonaId, setSignedInPersonaId] = useState<string | null>(null);",
          "  const signedInPersona = signedInPersonaId ? { email: 'riley@acme.example', organizationId: 'org_acme', role: 'owner', permissions: [] } as LocalPersona : null;",
          "  if (!signedInPersona) {",
          "    return <LoginScreen personas={personas} selectedPersonaId={personaId} onPersonaChange={setPersonaId} onSignIn={() => setSignedInPersonaId(personaId)} />;",
          "  }",
          "  return (",
          "    <LocalForgeProvider persona={signedInPersona}>",
          "      <App persona={signedInPersona} personas={personas} onPersonaChange={() => undefined} onSignOut={() => setSignedInPersonaId(null)} />",
          "    </LocalForgeProvider>",
          "  );",
          "}",
          "function LoginScreen(_props: { personas: LocalPersona[]; selectedPersonaId: string; onPersonaChange: (personaId: string) => void; onSignIn: () => void }) {",
          "  const _permissions = useMemo(() => [], []);",
          "  return <main><button type=\"button\" onClick={_props.onSignIn}>Continue with local identity</button></main>;",
          "}",
          "function LocalForgeProvider({ persona, children }: { persona: LocalPersona; children: ReactNode }) {",
          "  return <ForgeProvider url={forgeUrl} devAuth={{ userId: persona.email }}>{children}</ForgeProvider>;",
          "}",
          'createRoot(document.getElementById("root")!).render(<StrictMode><Root /></StrictMode>);',
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.changed).toContain("web/src/main.tsx");
      const main = readFileSync(join(workspace, "web/src/main.tsx"), "utf8");
      expect(main).toContain('import { ForgeWorkOSAuthProvider, hasWorkOSBrowserConfig, useForgeWorkOSSession, useWorkOSAuth } from "./lib/workos-auth";');
      expect(main).toContain("if (hasWorkOSBrowserConfig())");
      expect(main).toContain("function WorkOSVendorAccessRoot()");
      expect(main).toContain("Sign in with WorkOS");
      expect(main).toContain("const workosSession = useForgeWorkOSSession();");
      expect(main).toContain("const claims = workosSession.session?.claims;");
      expect(main).toContain("Organization, role, and permissions come from your signed-in workspace session");
      expect(main).toContain("const persona: LocalPersona");
      expect(main).not.toContain("const persona: DemoPersona");
      expect(main.indexOf("if (hasWorkOSBrowserConfig())")).toBeLessThan(main.indexOf("if (!signedInPersona)"));
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("continues WorkOS recipe generation when packages are already declared", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-predeclared");
    try {
      const rootPkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      rootPkg.dependencies = {
        ...rootPkg.dependencies,
        "@workos-inc/node": "^10.7.0",
      };
      writeFileSync(join(workspace, "package.json"), `${JSON.stringify(rootPkg, null, 2)}\n`, "utf8");

      mkdirSync(join(workspace, "web", "src", "lib"), { recursive: true });
      writeFileSync(
        join(workspace, "web", "package.json"),
        JSON.stringify(
          {
            name: "forge-workos-web",
            private: true,
            type: "module",
            dependencies: {
              react: "^19.0.0",
              "@workos-inc/authkit-react": "^1.0.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "lib", "forge.ts"),
        "export const forgeUrl = ''; export function ForgeProvider(props: { children: unknown; url?: string; devAuth?: boolean }) { return props.children; }\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "main.tsx"),
        [
          'import { createRoot } from "react-dom/client";',
          'import { ForgeProvider, forgeUrl } from "./lib/forge";',
          "function App() { return <main>App</main>; }",
          'createRoot(document.getElementById("root")!).render(<ForgeProvider url={forgeUrl} devAuth><App /></ForgeProvider>);',
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFailingPmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.warnings.map((warning) => warning.code)).toContain("FORGE_ADD_PACKAGE_ALREADY_DECLARED");
      expect(result.changed).toContain("web/src/lib/workos-auth.tsx");
      expect(result.changed).toContain("web/src/main.tsx");
      expect(result.changed).not.toContain("package.json");
      expect(result.changed).not.toContain("web/package.json");
      expect(readFileSync(join(workspace, "web", "src", "main.tsx"), "utf8")).toContain(
        "<ForgeWorkOSAuthProvider>",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("continues WorkOS recipe generation when AuthKit is already installed but not declared", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-authkit-installed");
    try {
      const rootPkg = JSON.parse(readFileSync(join(workspace, "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      rootPkg.dependencies = {
        ...rootPkg.dependencies,
        "@workos-inc/node": "^10.7.0",
      };
      writeFileSync(join(workspace, "package.json"), `${JSON.stringify(rootPkg, null, 2)}\n`, "utf8");

      mkdirSync(join(workspace, "web", "src", "lib"), { recursive: true });
      writeFileSync(
        join(workspace, "web", "package.json"),
        JSON.stringify(
          {
            name: "forge-workos-web",
            private: true,
            type: "module",
            dependencies: {
              react: "^19.0.0",
            },
          },
          null,
          2,
        ),
        "utf8",
      );
      seedInstalledPackage(join(workspace, "web"), "@workos-inc/authkit-react", "1.2.3");
      writeFileSync(
        join(workspace, "web", "src", "lib", "forge.ts"),
        "export const forgeUrl = ''; export function ForgeProvider(props: { children: unknown; url?: string; devAuth?: boolean }) { return props.children; }\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web", "src", "main.tsx"),
        [
          'import { createRoot } from "react-dom/client";',
          'import { ForgeProvider, forgeUrl } from "./lib/forge";',
          "function App() { return <main>App</main>; }",
          'createRoot(document.getElementById("root")!).render(<ForgeProvider url={forgeUrl} devAuth><App /></ForgeProvider>);',
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFailingPmAdapter(),
      });

      expect(result.exitCode).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.warnings.map((warning) => warning.code)).toContain("FORGE_ADD_PACKAGE_ALREADY_INSTALLED");
      expect(result.changed).toContain("web/package.json");
      expect(result.changed).toContain("web/src/lib/workos-auth.tsx");
      expect(result.changed).toContain("web/src/main.tsx");
      const webPkg = JSON.parse(readFileSync(join(workspace, "web", "package.json"), "utf8")) as {
        dependencies?: Record<string, string>;
      };
      expect(webPkg.dependencies?.["@workos-inc/authkit-react"]).toBe("^1.2.3");
      expect(readFileSync(join(workspace, "web", "src", "main.tsx"), "utf8")).toContain(
        "<ForgeWorkOSAuthProvider>",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("generated workos adapter typechecks against the WorkOS v10 factory API", async () => {
    const workspace = scaffoldAddWorkspace("add-workos-typecheck");
    try {
      const result = await forgeAdd("workos", {
        workspaceRoot: workspace,
        json: true,
        dryRun: false,
        runtimeInspect: false,
        sandboxBackend: "none",
        allowScripts: false,
        mode: "integration",
        pmAdapter: createFixturePmAdapter(),
      });
      expect(result.exitCode).toBe(0);

      const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      writeFileSync(
        join(workspace, "tsconfig.workos.json"),
        JSON.stringify(
          {
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              allowImportingTsExtensions: true,
              skipLibCheck: true,
              types: [],
            },
            include: [
              "src/forge/_generated/packages/workos.server.ts",
              "src/forge/_generated/integrations/workos/*.ts",
              "src/forge/_generated/testkits/workos.mock.ts",
              "src/forge/_generated/secretsContext.ts",
            ],
          },
          null,
          2,
        ),
        "utf8",
      );
      const tsc = Bun.spawnSync({
        cmd: [
          process.execPath,
          join(process.cwd(), "node_modules", "typescript", "bin", "tsc"),
          "--noEmit",
          "-p",
          "tsconfig.workos.json",
        ],
        cwd: workspace,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(tsc.exitCode, `${tsc.stdout.toString()}\n${tsc.stderr.toString()}`).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 15_000);

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
