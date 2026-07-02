import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { buildCheckJson } from "../../src/forge/cli/output.ts";
import { classifyChangeType } from "../../src/forge/workspace/change-summary.ts";
import { main } from "../../src/forge/cli/main.ts";
import { resolveBunExecutable } from "../../src/forge/cli/bun-exec.ts";
import { runGenerateCommand, runReleaseDoctorCommand } from "../../src/forge/cli/commands.ts";
import { runAuthMdCommand } from "../../src/forge/cli/authmd.ts";
import { runAuthCommand } from "../../src/forge/cli/auth.ts";
import { runPgliteDoctorCommand, runRuntimeDoctorCommand } from "../../src/forge/cli/doctor.ts";
import { formatWorkOSHuman, runWorkOSCommand } from "../../src/forge/cli/workos.ts";
import { runTestCommand } from "../../src/forge/impact/index.ts";
import {
  probeStudioPreview,
  runStudioAttachCommand,
  runStudioBridgeCommand,
  runStudioCodexServerCommand,
  runStudioOpenCommand,
  runStudioSnapshotCommand,
  runStudioWatchCommand,
} from "../../src/forge/cli/studio.ts";
import {
  buildStrictTestGraphPlan,
  chunkFiles,
  classifyStrictTestFile,
  packWeightedStrictTestChunks,
  resolveStrictIsolatedTestJobs,
  resolveStrictTestJobs,
} from "../../src/forge/cli/verify.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

async function listenOnRandomPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate test port");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe("Forge CLI", () => {
  test("runGenerateCommand respects workspaceRoot when cwd differs", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-generate-workspace-root");
    const otherCwd = mkdtempSync(join(tmpdir(), "forge-generate-cwd-"));
    const previousCwd = process.cwd();
    try {
      const write = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      expect(write.exitCode).toBe(0);

      process.chdir(otherCwd);
      const check = await runGenerateCommand({
        workspaceRoot: workspace,
        check: true,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      expect(check.exitCode).toBe(0);
      expect(check.changed).toEqual([]);
      expect(process.cwd()).toBe(otherCwd);
    } finally {
      process.chdir(previousCwd);
      cleanupWorkspace(workspace);
      rmSync(otherCwd, { recursive: true, force: true });
    }
  });

  test("parseCli rejects unsupported inspect target", () => {
    const parsed = parseCli(["inspect", "unknown"]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.command).toBeNull();
  });

  test("parseCli defaults bare inspect to summary", () => {
    const parsed = parseCli(["inspect", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "inspect",
      target: "summary",
      json: true,
    });
  });

  test("parseCli accepts supported inspect targets", () => {
    for (const target of [
      "app",
      "packages",
      "capabilities",
      "runtime-matrix",
      "data",
      "runtime",
      "dev",
      "agent-contract",
      "summary",
      "schema",
      "drift",
      "handoff",
      "framework",
      "imported",
    ]) {
      const parsed = parseCli(["inspect", target]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("inspect");
    }
  });

  test("parseCli accepts brownfield import commands", () => {
    const analyze = parseCli(["import", "analyze", "--json", "--dry-run"]);
    expect(analyze.errors).toEqual([]);
    expect(analyze.command?.kind).toBe("import");
    if (analyze.command?.kind === "import") {
      expect(analyze.command.options.subcommand).toBe("analyze");
      expect(analyze.command.options.dryRun).toBe(true);
    }

    const inspect = parseCli(["import", "inspect", "--entry", "users.read", "--target", "candidate-entries", "--json"]);
    expect(inspect.errors).toEqual([]);
    expect(inspect.command?.kind).toBe("import");
    if (inspect.command?.kind === "import") {
      expect(inspect.command.options.subcommand).toBe("inspect");
      expect(inspect.command.options.entry).toBe("users.read");
      expect(inspect.command.options.target).toBe("candidate-entries");
    }
  });

  test("parseCli accepts status, changed, and handoff", () => {
    const parsed = parseCli(["status", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("status");
    if (parsed.command?.kind === "status") {
      expect(parsed.command.json).toBe(true);
    }

    const changed = parseCli(["changed", "--json"]);
    expect(changed.errors).toEqual([]);
    expect(changed.command?.kind).toBe("changed");
    if (changed.command?.kind === "changed") {
      expect(changed.command.json).toBe(true);
    }

    const authoredChanged = parseCli(["changed", "--authored", "--json"]);
    expect(authoredChanged.errors).toEqual([]);
    expect(authoredChanged.command?.kind).toBe("changed");
    if (authoredChanged.command?.kind === "changed") {
      expect(authoredChanged.command.authoredOnly).toBe(true);
    }

    const reviewChanged = parseCli(["changed", "--review", "--json"]);
    expect(reviewChanged.errors).toEqual([]);
    expect(reviewChanged.command?.kind).toBe("changed");
    if (reviewChanged.command?.kind === "changed") {
      expect(reviewChanged.command.reviewOnly).toBe(true);
    }

    const commitReadyChanged = parseCli(["changed", "--commit-ready", "--json"]);
    expect(commitReadyChanged.errors).toEqual([]);
    expect(commitReadyChanged.command).toMatchObject({
      kind: "changed",
      commitReady: true,
      json: true,
    });

    const diff = parseCli(["diff", "authored", "--json"]);
    expect(diff.errors).toEqual([]);
    expect(diff.command).toMatchObject({ kind: "diff", target: "authored", json: true });

    const handoff = parseCli(["handoff", "--json"]);
    expect(handoff.errors).toEqual([]);
    expect(handoff.command?.kind).toBe("handoff");
    if (handoff.command?.kind === "handoff") {
      expect(handoff.command.json).toBe(true);
    }

    const commitReadyHandoff = parseCli(["handoff", "--commit-ready", "--json"]);
    expect(commitReadyHandoff.errors).toEqual([]);
    expect(commitReadyHandoff.command).toMatchObject({
      kind: "handoff",
      commitReady: true,
      json: true,
    });

    const baseline = parseCli(["baseline", "create", "--reason", "initial-scaffold", "--json"]);
    expect(baseline.errors).toEqual([]);
    expect(baseline.command?.kind).toBe("baseline");
    if (baseline.command?.kind === "baseline") {
      expect(baseline.command.subcommand).toBe("create");
      expect(baseline.command.reason).toBe("initial-scaffold");
    }
  });

  test("parseCli accepts dev lifecycle, authz proof, and UI ergonomics inspection", () => {
    expect(hasUnknownOption(["dev", "--detach", "--json"])).toBeNull();
    expect(hasUnknownOption(["dev", "--seed", "--seed-command", "seedVendorAccessDemo", "--json"])).toBeNull();
    expect(hasUnknownOption(["seed", "dev", "--all-tenants", "--json"])).toBeNull();
    expect(hasUnknownOption(["inspect", "ui", "--ergonomics", "--json"])).toBeNull();
    expect(hasUnknownOption(["test", "authz", "--tenant", "acme", "--other-tenant", "globex", "--json"])).toBeNull();
    expect(hasUnknownOption(["workos", "prove", "--real", "--file", "workos-seed.yml", "--json"])).toBeNull();

    const devStatus = parseCli(["dev", "status", "--json"]);
    expect(devStatus.errors).toEqual([]);
    expect(devStatus.command).toMatchObject({ kind: "dev", lifecycle: "status", json: true });

    const devDetach = parseCli(["dev", "--detach", "--db", "memory", "--port", "0", "--json"]);
    expect(devDetach.errors).toEqual([]);
    expect(devDetach.command).toMatchObject({ kind: "dev", detach: true, db: "memory", port: 0 });

    const devSeed = parseCli(["dev", "--seed", "--seed-command", "seedVendorAccessDemo", "--all-tenants", "--json"]);
    expect(devSeed.errors).toEqual([]);
    expect(devSeed.command).toMatchObject({
      kind: "dev",
      seed: true,
      seedCommand: "seedVendorAccessDemo",
      seedAllTenants: true,
      json: true,
    });

    const devAllTenantsWithoutSeed = parseCli(["dev", "--all-tenants"]);
    expect(devAllTenantsWithoutSeed.errors).toContain("forge dev --all-tenants requires --seed; use forge dev --seed --all-tenants");

    const devSeedOnce = parseCli(["dev", "--once", "--seed"]);
    expect(devSeedOnce.errors).toContain("forge dev --seed cannot be combined with --once; use forge dev --seed or forge seed dev");

    const devSeedWebOnly = parseCli(["dev", "--web-only", "--seed"]);
    expect(devSeedWebOnly.errors).toContain("forge dev --seed cannot be combined with --web-only because seeding requires the API runtime");

    const authz = parseCli(["test", "authz", "--tenant", "acme", "--other-tenant", "globex", "--json"]);
    expect(authz.errors).toEqual([]);
    expect(authz.command).toMatchObject({
      kind: "test",
      options: { subcommand: "authz", tenant: "acme", otherTenant: "globex" },
    });

    const inspect = parseCli(["inspect", "ui", "--ergonomics", "--json"]);
    expect(inspect.errors).toEqual([]);
    expect(inspect.command).toMatchObject({ kind: "inspect", target: "ui", ergonomics: true });
  });

  test("dev help is command-specific", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["dev", "--help"]);
      expect(code).toBe(0);
      expect(output).toContain("forge dev --db memory --port 3777 --web-port 5174");
      expect(output).toContain("forge dev --db memory --port 0 --web-port 0");
      expect(output).toContain("forge dev --seed --db pglite");
      expect(output).toContain("forge dev --seed --all-tenants --db pglite");
      expect(output).toContain("--all-tenants");
      expect(output).toContain("forge dev --detach --db memory --port 0 --json");
      expect(output).toContain("--web-port <port>                 Web dev server port; use 0 for an ephemeral port");
      expect(output).not.toContain("Start with one of these:");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("parseCli accepts explicit forge new --git as the default git behavior", () => {
    const parsed = parseCli(["new", "demo-app", "--template", "minimal-web", "--git", "--no-install"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "new",
      name: "demo-app",
      git: true,
      install: false,
    });
  });

  test("parseCli accepts docs check and classifies tracked Codex hooks as config", () => {
    const parsed = parseCli(["docs", "check", "--json"]);
    expect(parsed.command).toMatchObject({
      kind: "docs",
      subcommand: "check",
      json: true,
    });
    expect(classifyChangeType(".codex/hooks.json")).toBe("config");
    expect(classifyChangeType("scripts/field-test-forgeos.mjs")).toBe("source");
    expect(classifyChangeType("packages/create-forge-app/bin/create-forge-app.mjs")).toBe("source");
  });

  test("check JSON success does not recommend running check again", () => {
    const json = buildCheckJson({
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [],
      exitCode: 0,
    });
    expect(json.nextActions).not.toContain("forge check --json");
    expect(json.nextActions).toContain("forge verify --changed");
  });

  test("check JSON can use repo-local Forge CLI commands", () => {
    const json = buildCheckJson(
      {
        changed: [],
        unchanged: [],
        warnings: [],
        errors: [],
        exitCode: 0,
      },
      { workspaceRoot: process.cwd() },
    );
    expect(json.nextActions).toContain("node bin/forge.mjs verify --changed");
    expect(json.nextActions).toContain("node bin/forge.mjs handoff --json");
    expect(json.nextActions).not.toContain("forge handoff --json");
  });

  test("parseCli accepts explicit human status output", () => {
    expect(hasUnknownOption(["status", "--human"])).toBeNull();
    const parsed = parseCli(["status", "--human"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("status");
  });

  test("parseCli accepts studio attach for external agent workrooms", () => {
    const parsed = parseCli([
      "studio",
      "attach",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--target",
      "codex",
      "--target",
      "claude",
      "--json",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("studio");
    if (parsed.command?.kind === "studio") {
      expect(parsed.command.subcommand).toBe("attach");
      expect(parsed.command.path).toBe("C:/work/customer-app");
      expect(parsed.command.previewPort).toBe(5174);
      expect(parsed.command.targets).toEqual(["codex", "claude"]);
      expect(parsed.command.json).toBe(true);
    }

    const noPath = parseCli(["studio", "attach", "--target", "codex", "--json"]);
    expect(noPath.errors).toEqual([]);
    expect(noPath.command?.kind).toBe("studio");
    if (noPath.command?.kind === "studio") {
      expect(noPath.command.path).toBeUndefined();
      expect(noPath.command.targets).toEqual(["codex"]);
    }
  });

  test("parseCli accepts studio snapshot for observer state", () => {
    const parsed = parseCli([
      "studio",
      "snapshot",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--target",
      "codex",
      "--json",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("studio");
    if (parsed.command?.kind === "studio") {
      expect(parsed.command.subcommand).toBe("snapshot");
      expect(parsed.command.path).toBe("C:/work/customer-app");
      expect(parsed.command.previewPort).toBe(5174);
      expect(parsed.command.targets).toEqual(["codex"]);
      expect(parsed.command.json).toBe(true);
    }
  });

  test("parseCli accepts studio open, watch, bridge, doctor, and codex-server", () => {
    for (const subcommand of ["open", "watch", "bridge", "doctor", "codex-server"] as const) {
      const parsed = parseCli([
        "studio",
        subcommand,
        "C:/work/customer-app",
        "--preview-port",
        "5174",
        "--studio-url",
        "http://127.0.0.1:3765",
        "--interval-ms",
        "2000",
        "--target",
        "codex",
        "--workspace-id",
        "workspace_1",
        "--tenant-id",
        "tenant_1",
        "--user-id",
        "user_1",
        "--role",
        "owner",
        "--once",
        "--json",
      ]);

      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("studio");
      if (parsed.command?.kind === "studio") {
        expect(parsed.command.subcommand).toBe(subcommand);
        expect(parsed.command.path).toBe("C:/work/customer-app");
        expect(parsed.command.previewPort).toBe(5174);
        expect(parsed.command.studioUrl).toBe("http://127.0.0.1:3765");
        expect(parsed.command.intervalMs).toBe(2000);
        expect(parsed.command.workspaceId).toBe("workspace_1");
        expect(parsed.command.tenantId).toBe("tenant_1");
        expect(parsed.command.userId).toBe("user_1");
        expect(parsed.command.role).toBe("owner");
        expect(parsed.command.once).toBe(true);
        expect(parsed.command.writeSchemas).toBe(false);
        expect(parsed.command.probeAppServer).toBe(false);
        expect(parsed.command.targets).toEqual(["codex"]);
      }
    }

    const codexServer = parseCli(["studio", "codex-server", ".", "--write", "--probe", "--json"]);
    expect(codexServer.errors).toEqual([]);
    expect(codexServer.command?.kind).toBe("studio");
    if (codexServer.command?.kind === "studio") {
      expect(codexServer.command.subcommand).toBe("codex-server");
      expect(codexServer.command.writeSchemas).toBe(true);
      expect(codexServer.command.probeAppServer).toBe(true);
    }

    expect(hasUnknownOption(["studio", "open", "--install", "--no-start", "--no-bridge", "--probe-codex-server"])).toBeNull();
    const open = parseCli([
      "studio",
      "open",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--probe-codex-server",
      "--install",
      "--no-start",
      "--no-bridge",
      "--json",
    ]);
    expect(open.errors).toEqual([]);
    expect(open.command?.kind).toBe("studio");
    if (open.command?.kind === "studio") {
      expect(open.command.subcommand).toBe("open");
      expect(open.command.install).toBe(true);
      expect(open.command.start).toBe(false);
      expect(open.command.bridge).toBe(false);
      expect(open.command.probeAppServer).toBe(true);
    }
  });

  test("parseCli accepts forge add frontend and backend package targets", () => {
    const frontend = parseCli(["add", "lucide-react", "--frontend", "--json"]);
    expect(frontend.errors).toEqual([]);
    expect(frontend.command?.kind).toBe("add");
    if (frontend.command?.kind === "add") {
      expect(frontend.command.alias).toBe("lucide-react");
      expect(frontend.command.options.packageTarget).toBe("frontend");
      expect(frontend.command.options.json).toBe(true);
    }

    const backend = parseCli(["add", "hono", "--backend"]);
    expect(backend.errors).toEqual([]);
    expect(backend.command?.kind).toBe("add");
    if (backend.command?.kind === "add") {
      expect(backend.command.options.packageTarget).toBe("backend");
    }

    const workos = parseCli(["add", "auth", "workos", "--json"]);
    expect(workos.errors).toEqual([]);
    expect(workos.command?.kind).toBe("add");
    if (workos.command?.kind === "add") {
      expect(workos.command.alias).toBe("workos");
      expect(workos.command.options.mode).toBe("integration");
      expect(workos.command.options.json).toBe(true);
    }
  });

  test("authmd generate writes public auth metadata and check detects drift", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-authmd");
    try {
      const generated = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      expect(generated.exitCode).toBe(0);

      const parsed = parseCli(["authmd", "generate", "--json"]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("authmd");

      const write = runAuthMdCommand({
        subcommand: "generate",
        workspaceRoot: workspace,
        json: true,
      });
      expect(write.exitCode).toBe(0);
      expect(write.changed).toBe(true);
      expect(existsSync(join(workspace, "public", "auth.md"))).toBe(true);
      expect(existsSync(join(workspace, "public", ".well-known", "oauth-protected-resource"))).toBe(true);
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain("## Protected Resource Metadata");
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain(
        "## OAuth 2.0 Protected Resource Metadata",
      );
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain("## Risk And Approval Metadata");
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain("## Actions");
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain("## App Docs");
      expect(readFileSync(join(workspace, "public", "auth.md"), "utf8")).toContain(
        "| `charge` | `public` | yes | write | false |",
      );
      const metadataContent = readFileSync(
        join(workspace, "public", ".well-known", "oauth-protected-resource"),
        "utf8",
      );
      expect(metadataContent).toContain('"resource_documentation": "/auth.md"');
      const metadata = JSON.parse(metadataContent) as {
        forge: { risks: Array<{ kind: string; name: string; risk: string }>; docs: string[]; actions: string[] };
      };
      expect(Array.isArray(metadata.forge.risks)).toBe(true);
      expect(metadata.forge.risks).toContainEqual(
        expect.objectContaining({ kind: "command", name: "charge", risk: "write" }),
      );
      expect(Array.isArray(metadata.forge.docs)).toBe(true);
      expect(Array.isArray(metadata.forge.actions)).toBe(true);
      expect(
        readFileSync(join(workspace, "public", ".well-known", "oauth-protected-resource"), "utf8"),
      ).toContain('"resource_documentation": "/auth.md"');

      const check = runAuthMdCommand({
        subcommand: "check",
        workspaceRoot: workspace,
        json: true,
      });
      expect(check.exitCode).toBe(0);
      expect(check.changed).toBe(false);

      writeFileSync(join(workspace, ".env.local"), "FORGE_AUTH_MODE=oidc\nWORKOS_CLIENT_ID=client_test\n", "utf8");
      const missingAuthEnv = runAuthMdCommand({
        subcommand: "check",
        workspaceRoot: workspace,
        json: true,
      });
      expect(missingAuthEnv.exitCode).toBe(1);
      expect(missingAuthEnv.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_AUTHMD_AUTH_ENV_MISSING",
      );
      expect(JSON.stringify(missingAuthEnv.diagnostics)).toContain("https://api.workos.com/sso/jwks/client_test");

      writeFileSync(
        join(workspace, ".env.local"),
        [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_JWKS_URI=https://api.workos.com/sso/jwks/client_test",
          "WORKOS_CLIENT_ID=client_test",
          "",
        ].join("\n"),
        "utf8",
      );
      const completeAuthEnv = runAuthMdCommand({
        subcommand: "check",
        workspaceRoot: workspace,
        json: true,
      });
      expect(completeAuthEnv.exitCode).toBe(0);

      writeFileSync(join(workspace, "public", "auth.md"), "# stale\n", "utf8");
      const stale = runAuthMdCommand({
        subcommand: "check",
        workspaceRoot: workspace,
        json: true,
      });
      expect(stale.exitCode).toBe(1);
      expect(stale.diagnostics[0]?.code).toBe("FORGE_AUTHMD_DRIFT");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("workos doctor and seed validate local adapter artifacts", () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-workos-cli-"));
    try {
      mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
      mkdirSync(join(workspace, "src/forge/_generated"), { recursive: true });
      mkdirSync(join(workspace, "web/src/lib"), { recursive: true });
      writeFileSync(
        join(workspace, "package.json"),
        JSON.stringify({ dependencies: { "@workos-inc/node": "^7.0.0" } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web/package.json"),
        JSON.stringify({ dependencies: { "@workos-inc/authkit-react": "^1.0.0" } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/authRegistry.json"),
        JSON.stringify({ claims: { userId: "sub", tenantId: "organization_id" } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/secretRegistry.json"),
        JSON.stringify({
          secrets: [
            { envVar: "WORKOS_API_KEY" },
            { envVar: "WORKOS_CLIENT_ID" },
            { envVar: "WORKOS_COOKIE_PASSWORD" },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, ".env.example"),
        [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_JWKS_URI=",
          "VITE_WORKOS_CLIENT_ID=",
          "VITE_WORKOS_REDIRECT_URI=http://localhost:5173/callback",
          "WORKOS_API_KEY=",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(join(workspace, "src/policies.workos.ts"), "export {};\n", "utf8");
      writeFileSync(
        join(workspace, "web/src/lib/workos-auth.tsx"),
        [
          "export function AuthKitProvider() {}",
          "export function ForgeProvider() {}",
          "export function ForgeWorkOSAuthProvider() {",
          "  const getAccessToken = () => undefined;",
          "  return getAccessToken;",
          "}",
          "export function useForgeWorkOSSession() {",
          "  return fetch('/session', { credentials: 'include' }).then((response) => response.json()).then((session) => session.claims);",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(workspace, "web/src/main.tsx"),
        "import { ForgeWorkOSAuthProvider } from './lib/workos-auth'; export const root = ForgeWorkOSAuthProvider;\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "web/vite.config.ts"),
        [
          "const forgeProxyPaths = [",
          "  '/login',",
          "  '/callback',",
          "  '/logout',",
          "  '/session',",
          "];",
          "export default forgeProxyPaths;",
          "",
        ].join("\n"),
        "utf8",
      );
      const webViteConfigWithSessionProxy = readFileSync(join(workspace, "web/vite.config.ts"), "utf8");
      const seedYaml = [
          "permissions:",
          "  - slug: 'onboarding:read'",
          "  - slug: 'invitations:create'",
          "  - slug: 'tasks:update'",
          "resource_types:",
          "  - slug: 'organization'",
          "  - slug: 'project'",
          "  - slug: 'taskGroup'",
          "  - slug: 'task'",
          "roles:",
          "  - slug: 'owner'",
          "  - slug: 'manager'",
          "  - slug: 'member'",
          "organizations:",
          "  - name: 'Acme Corp'",
          "    domains: ['acme.test']",
          "  - name: 'Globex'",
          "    domains: ['globex.test']",
          "config:",
          "  redirect_uris:",
          "    - 'http://localhost:5173'",
          "    - 'http://localhost:5173/callback'",
          "  cors_origins:",
          "    - 'http://localhost:5173'",
          "  homepage_url: 'http://localhost:5173'",
          "  webhook_endpoints:",
          "    - url: 'http://localhost:3765/webhooks/workos'",
          "      events:",
          "        - 'authentication.succeeded'",
          "",
        ].join("\n");
      writeFileSync(
        join(workspace, "workos-seed.yml"),
        seedYaml,
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/workos-seed.yml"),
        seedYaml,
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"),
        'export const config = { provider: "workos" }; export function verifyWorkOSWebhook() {} export function handleWorkOSWebhook() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"),
        'export const workosAuthHttpRoutes = ["/login", "/callback", "/logout", "/session"]; export function handleWorkOSAuthRequest() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/session.ts"),
        "export function encodeWorkOSSession() {} export function decodeWorkOSSession() {} export function workOSSessionToClaims() {}\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"),
        'export const workosWebhookHttpRoute = { path: "/webhooks/workos" }; export function handleWorkOSWebhookRequest() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"),
        'export class ForgeWorkOSFgaDecisionCache {} export function canWorkOS() { return { permissionSlug: "x", resourceExternalId: "y" }; } export function syncWorkOSResourceGraph() {} export function workOSResourceRecords() {} export function assertWorkOSResourceTenant() { throw new Error("FORGE_WORKOS_CROSS_TENANT_RESOURCE"); }\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/fga.ts"),
        'export const forgeWorkOSResourceTypes = ["organization", "project", "task"];\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/policies.workos.ts"),
        'import { canPermission } from "forge/policy"; export const policies = { "invitations.create": canPermission("invitations:create"), "tasks.update": canPermission("tasks:update") };\n',
        "utf8",
      );

      const parsedInstall = parseCli(["workos", "install", "--yes", "--json"]);
      expect(parsedInstall.errors).toEqual([]);
      expect(parsedInstall.command?.kind).toBe("workos");
      if (parsedInstall.command?.kind === "workos") {
        expect(parsedInstall.command.subcommand).toBe("install");
        expect(parsedInstall.command.yes).toBe(true);
      }
      const parsedSetup = parseCli(["workos", "setup", "--real", "--file", "workos-seed.yml", "--json"]);
      expect(parsedSetup.errors).toEqual([]);
      expect(parsedSetup.command).toMatchObject({ kind: "workos", subcommand: "setup", real: true });
      const parsedProve = parseCli(["workos", "prove", "--file", "workos-seed.yml", "--json"]);
      expect(parsedProve.errors).toEqual([]);
      expect(parsedProve.command).toMatchObject({ kind: "workos", subcommand: "prove", file: "workos-seed.yml" });

      const parsed = parseCli(["workos", "doctor", "--json"]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("workos");

      const install = runWorkOSCommand({
        subcommand: "install",
        workspaceRoot: workspace,
        json: true,
        yes: true,
        dryRun: false,
        commandRunner: (command, args, options) => {
          expect(command).toBe("npx");
          expect(args).toEqual(["--yes", "workos@latest", "install"]);
          expect(options.cwd).toBe(workspace);
          return { status: 0, stdout: "workos install ok\n", stderr: "" };
        },
      });
      expect(install.exitCode).toBe(0);
      expect(install.applied).toBe(true);
      expect(install.stdout).toBe("workos install ok\n");

      const doctor = runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
      });
      expect(doctor.exitCode).toBe(0);
      expect(doctor.ok).toBe(true);
      expect(doctor.applied).toBe(false);
      expect(doctor.command).toEqual(["npx", "--yes", "workos@latest", "doctor"]);
      expect(doctor.checks.map((check) => check.name)).toContain("webhook-http-handler");
      expect(doctor.checks.map((check) => check.name)).toContain("authkit-routes");
      expect(doctor.checks.map((check) => check.name)).toContain("authkit-session");
      expect(doctor.checks.map((check) => check.name)).toContain("browser-authkit-bridge");
      expect(doctor.checks.map((check) => check.name)).toContain("browser-authkit-session-proxy");
      expect(doctor.checks.map((check) => check.name)).toContain("seed-organizations");
      expect(doctor.checks.map((check) => check.name)).toContain("seed-roles-permissions");
      expect(doctor.checks.map((check) => check.name)).toContain("seed-resource-types");
      expect(doctor.checks.map((check) => check.name)).toContain("seed-auth-config");

      writeFileSync(
        join(workspace, "web/vite.config.ts"),
        "export default ['/login', '/callback', '/logout'];\n",
        "utf8",
      );
      const missingSessionProxyDoctor = runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
      });
      expect(missingSessionProxyDoctor.exitCode).toBe(1);
      expect(JSON.stringify(missingSessionProxyDoctor.checks)).toContain("browser-authkit-session-proxy");
      expect(JSON.stringify(missingSessionProxyDoctor.checks)).toContain("web dev config should proxy /session");
      writeFileSync(join(workspace, "web/vite.config.ts"), webViteConfigWithSessionProxy, "utf8");

      const delegatedDoctor = runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: workspace,
        json: true,
        yes: true,
        dryRun: false,
        commandRunner: (command, args, options) => {
          expect(command).toBe("npx");
          expect(args).toEqual(["--yes", "workos@latest", "doctor"]);
          expect(options.cwd).toBe(workspace);
          return { status: 0, stdout: "workos doctor ok\n", stderr: "" };
        },
      });
      expect(delegatedDoctor.exitCode).toBe(0);
      expect(delegatedDoctor.applied).toBe(true);
      expect(delegatedDoctor.stdout).toBe("workos doctor ok\n");
      expect(JSON.stringify(delegatedDoctor.data)).toContain('"activePermissions"');
      expect(JSON.stringify(delegatedDoctor.data)).toContain('"onboarding:read"');
      expect(JSON.stringify(delegatedDoctor.data)).toContain('"seedState"');
      expect(JSON.stringify(delegatedDoctor.data)).toContain('"matchesSeedHash":null');

      const seedDryRun = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: true,
      });
      expect(seedDryRun.exitCode).toBe(0);
      expect(seedDryRun.applied).toBe(false);
      expect(seedDryRun.command).toEqual([
        "npx",
        "--yes",
        "workos@latest",
        "seed",
        "--file",
        "workos-seed.yml",
      ]);
      expect(JSON.stringify(seedDryRun.data)).toContain('"dryRun":true');
      expect(JSON.stringify(seedDryRun.data)).toContain('"exists":false');
      expect(JSON.stringify(seedDryRun.data)).toContain('"matchesSeedHash":null');
      expect(JSON.stringify(seedDryRun.data)).toContain("forge workos seed --file workos-seed.yml --json");

      const seedCommands: string[][] = [];
      const seed = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
        commandRunner: (command, args, options) => {
          expect(command).toBe("npx");
          seedCommands.push(args);
          expect(options.cwd).toBe(workspace);
          return { status: 0, stdout: "workos seed ok\n", stderr: "" };
        },
      });
      expect(seed.exitCode).toBe(0);
      expect(seed.applied).toBe(true);
      expect(seed.stdout).toBe("workos seed ok\n");
      expect(seedCommands).toContainEqual(["--yes", "workos@latest", "config", "redirect", "add", "http://localhost:5173"]);
      expect(seedCommands).toContainEqual(["--yes", "workos@latest", "config", "cors", "add", "http://localhost:5173"]);
      expect(seedCommands).toContainEqual(["--yes", "workos@latest", "config", "homepage-url", "set", "http://localhost:5173"]);
      expect(seedCommands).toContainEqual(["--yes", "workos@latest", "seed", "--file", "workos-seed.yml"]);
      expect(JSON.stringify(seed.data)).toContain("WorkOS hosted webhook endpoints require HTTPS");
      expect(JSON.stringify(seed.data)).toContain('"seedStateFile":".workos-seed-state.json"');
      expect(JSON.stringify(seed.data)).toContain('"matchesSeedHash":true');
      const seedState = JSON.parse(readFileSync(join(workspace, ".workos-seed-state.json"), "utf8")) as {
        alreadyApplied: boolean;
        seedFile: string;
        seedHash: string;
        permissions: string[];
      };
      expect(seedState.alreadyApplied).toBe(false);
      expect(seedState.seedFile).toBe("workos-seed.yml");
      expect(seedState.seedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(seedState.permissions).toContain("onboarding:read");

      const duplicateSeed = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
        commandRunner: (_command, args) => args.includes("seed")
          ? {
              status: 1,
              stdout: "",
              stderr: "Permission slug already in use: invitations:create\n",
            }
          : { status: 0, stdout: "", stderr: "" },
      });
      expect(duplicateSeed.exitCode).toBe(0);
      expect(duplicateSeed.ok).toBe(true);
      expect(duplicateSeed.applied).toBe(false);
      expect(duplicateSeed.stderr).toBeUndefined();
      expect(JSON.stringify(duplicateSeed.data)).toContain('"seedAlreadyApplied":true');
      expect(JSON.stringify(duplicateSeed.data)).toContain('"seedAlreadyAppliedReason":"workos-cli-existing-resource"');
      expect(JSON.stringify(duplicateSeed.data)).toContain('"stderrSuppressed":true');
      expect(JSON.stringify(duplicateSeed.data)).toContain('"seedStateFile":".workos-seed-state.json"');
      expect(JSON.stringify(duplicateSeed.data)).toContain('"alreadyApplied":true');
      const duplicateSeedState = JSON.parse(readFileSync(join(workspace, ".workos-seed-state.json"), "utf8")) as {
        alreadyApplied: boolean;
        exitStatus: number;
      };
      expect(duplicateSeedState.alreadyApplied).toBe(true);
      expect(duplicateSeedState.exitStatus).toBe(1);

      const doctorAfterSeed = runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
      });
      const seedStateCheck = doctorAfterSeed.checks.find((check) => check.name === "seed-state");
      expect(seedStateCheck?.ok).toBe(true);
      expect(seedStateCheck?.detail).toContain(".workos-seed-state.json matches workos-seed.yml");
      expect(JSON.stringify(doctorAfterSeed.data)).toContain('"matchesSeedHash":true');
      expect(JSON.stringify(doctorAfterSeed.data)).toContain('"unusedSeedPermissions"');

      writeFileSync(join(workspace, "workos-seed.yml"), `${seedYaml}\n# changed after hosted seed\n`, "utf8");
      const driftedSeedDryRun = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: true,
      });
      expect(driftedSeedDryRun.exitCode).toBe(0);
      expect(JSON.stringify(driftedSeedDryRun.data)).toContain('"matchesSeedHash":false');

      const setupDryRun = runWorkOSCommand({
        subcommand: "setup",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: true,
        real: false,
        file: "workos-seed.yml",
      });
      expect(setupDryRun.exitCode).toBe(0);
      expect(JSON.stringify(setupDryRun.data)).toContain('"seedState"');
      expect(JSON.stringify(setupDryRun.data)).toContain('"matchesSeedHash":false');

      const proveDryRun = runWorkOSCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: true,
        real: false,
        file: "workos-seed.yml",
      });
      expect(proveDryRun.exitCode).toBe(0);
      expect(proveDryRun.applied).toBe(false);
      expect(proveDryRun.checks.map((check) => check.name)).toContain("seed:dry-run");
      expect(proveDryRun.checks.map((check) => check.name)).toContain("setup:dry-run");
      expect(JSON.stringify(proveDryRun.data)).toContain("forge workos prove --real --file workos-seed.yml --json");
      expect(formatWorkOSHuman(proveDryRun)).toContain("WorkOS proof dry-run passed");

      const proveRealMissingEnv = runWorkOSCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
        real: true,
        file: "workos-seed.yml",
      });
      expect(proveRealMissingEnv.exitCode).toBe(1);
      expect(proveRealMissingEnv.applied).toBe(false);
      expect(JSON.stringify(proveRealMissingEnv.checks)).toContain("setup:real-env-forge_auth_audience");
      expect(JSON.stringify(proveRealMissingEnv.checks)).toContain("FORGE_AUTH_AUDIENCE");

      writeFileSync(
        join(workspace, "workos-seed.yml"),
        "// @forge-generated generator=0.1.0-alpha.0 input=abc content=def\n" + seedYaml,
        "utf8",
      );
      const legacyHeaderSeed = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
        commandRunner: (command, args) => {
          expect(command).toBe("npx");
          if (!args.includes("seed")) {
            return { status: 0, stdout: "", stderr: "" };
          }
          const seedFileArg = args[4]!;
          expect(seedFileArg).not.toBe("workos-seed.yml");
          expect(readFileSync(seedFileArg, "utf8").startsWith("// @forge-generated")).toBe(false);
          expect(readFileSync(seedFileArg, "utf8")).toContain("permissions:");
          return { status: 0, stdout: "legacy seed ok\n", stderr: "" };
        },
      });
      expect(legacyHeaderSeed.exitCode).toBe(0);
      expect(legacyHeaderSeed.applied).toBe(true);
      expect(JSON.stringify(legacyHeaderSeed.data)).toContain('"seedFileSanitized":true');

      writeFileSync(
        join(workspace, ".env.local"),
        [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_AUDIENCE=client_test",
          "FORGE_AUTH_JWKS_URI=https://api.workos.com/sso/jwks/client_test",
          "WORKOS_API_KEY=sk_test_example",
          "WORKOS_CLIENT_ID=client_test",
          "WORKOS_COOKIE_PASSWORD=abcdefghijklmnopqrstuvwxyz123456",
          "",
        ].join("\n"),
        "utf8",
      );
      const setupReal = runWorkOSCommand({
        subcommand: "setup",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
        real: true,
        file: "workos-seed.yml",
        commandRunner: (_command, args) => args.includes("seed")
          ? { status: 0, stdout: "setup seed ok\n", stderr: "" }
          : { status: 0, stdout: "", stderr: "" },
      });
      expect(setupReal.exitCode).toBe(0);
      expect(setupReal.applied).toBe(true);
      expect(JSON.stringify(setupReal.data)).toContain('"seedState"');
      expect(JSON.stringify(setupReal.data)).toContain('"matchesSeedHash":true');
      expect(JSON.stringify(setupReal.data)).toContain('"seedStateFile":".workos-seed-state.json"');
      expect(formatWorkOSHuman(setupReal)).toContain("setup applied; .workos-seed-state.json matches the current seed");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("workos doctor derives permissions and resources from the app contract", () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-workos-vendor-cli-"));
    try {
      mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
      mkdirSync(join(workspace, "src/forge/_generated"), { recursive: true });
      writeFileSync(
        join(workspace, "package.json"),
        JSON.stringify({ dependencies: { "@workos-inc/node": "^7.0.0" } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/authRegistry.json"),
        JSON.stringify({ claims: { userId: "sub", tenantId: "organization_id" } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/secretRegistry.json"),
        JSON.stringify({
          secrets: [
            { envVar: "WORKOS_API_KEY" },
            { envVar: "WORKOS_CLIENT_ID" },
            { envVar: "WORKOS_COOKIE_PASSWORD" },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/policyRegistry.json"),
        JSON.stringify({
          policies: [
            { name: "vendors:read", permissions: ["vendors:read"] },
            { name: "access:approve", permissions: ["access:approve"] },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/dataGraph.json"),
        JSON.stringify({
          tables: [
            { name: "vendors", fields: [{ name: "tenantId" }, { name: "name" }] },
            { name: "accessRequests", fields: [{ name: "tenantId" }, { name: "status" }] },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/agentContract.json"),
        JSON.stringify({ auth: { requiresTenant: true } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, ".env.example"),
        [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_JWKS_URI=",
          "VITE_WORKOS_CLIENT_ID=",
          "VITE_WORKOS_REDIRECT_URI=http://localhost:5173/callback",
          "WORKOS_API_KEY=",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/policies.workos.ts"),
        'import { canPermission } from "forge/policy"; export const policies = { "vendors.read": canPermission("vendors:read"), "access.approve": canPermission("access:approve") };\n',
        "utf8",
      );
      const seedYaml = [
        "permissions:",
        "  - slug: 'vendors:read'",
        "  - slug: 'access:approve'",
        "  - slug: 'legacy:unused'",
        "resource_types:",
        "  - slug: 'organization'",
        "  - slug: 'vendor'",
        "  - slug: 'accessRequest'",
        "roles:",
        "  - slug: 'vendor'",
        "  - slug: 'auditor'",
        "organizations:",
        "  - name: 'Acme Corp'",
        "    domains: ['acme.test']",
        "config:",
        "  redirect_uris:",
        "    - 'http://localhost:5173'",
        "    - 'http://localhost:5173/callback'",
        "  cors_origins:",
        "    - 'http://localhost:5173'",
        "  homepage_url: 'http://localhost:5173'",
        "",
      ].join("\n");
      writeFileSync(join(workspace, "workos-seed.yml"), seedYaml, "utf8");
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"),
        'export const config = { provider: "workos" }; export function verifyWorkOSWebhook() {} export function handleWorkOSWebhook() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"),
        'export const workosAuthHttpRoutes = ["/login", "/callback", "/logout", "/session"]; export function handleWorkOSAuthRequest() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/session.ts"),
        "export function encodeWorkOSSession() {} export function decodeWorkOSSession() {} export function workOSSessionToClaims() {}\n",
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"),
        'export const workosWebhookHttpRoute = { path: "/webhooks/workos" }; export function handleWorkOSWebhookRequest() {}\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"),
        'export class ForgeWorkOSFgaDecisionCache {} export function canWorkOS() { return { permissionSlug: "x", resourceExternalId: "y" }; } export function syncWorkOSResourceGraph() {} export function workOSResourceRecords() {} export function assertWorkOSResourceTenant() { throw new Error("FORGE_WORKOS_CROSS_TENANT_RESOURCE"); }\n',
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/integrations/workos/fga.ts"),
        'export const forgeWorkOSResourceTypes = [{ slug: "organization" }, { slug: "vendor" }, { slug: "accessRequest" }];\n',
        "utf8",
      );

      const doctor = runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: false,
      });
      const seed = runWorkOSCommand({
        subcommand: "seed",
        workspaceRoot: workspace,
        json: true,
        yes: false,
        dryRun: true,
        file: "workos-seed.yml",
      });

      expect(doctor.exitCode).toBe(0);
      expect(seed.exitCode).toBe(0);
      expect(JSON.stringify(doctor.checks)).toContain("vendors:read");
      expect(JSON.stringify(doctor.checks)).toContain("seed-unused-permissions");
      expect(JSON.stringify(doctor.checks)).toContain("legacy:unused");
      expect(JSON.stringify(doctor.checks)).not.toContain("onboarding:read");
      expect(JSON.stringify(doctor.data)).toContain('"vendors:read"');
      expect(JSON.stringify(doctor.data)).toContain('"accessRequest"');
      expect(JSON.stringify(doctor.data)).toContain('"legacy:unused"');
      expect(JSON.stringify(doctor.data)).not.toContain("onboarding:read");
      expect(JSON.stringify(seed.data)).toContain("accessRequest");
      expect(JSON.stringify(seed.data)).toContain("legacy:unused");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("auth prove supports a local multi-tenant WorkOS proof scenario", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-auth-prove-mt-"));
    try {
      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
      mkdirSync(join(workspace, "src/forge/_generated"), { recursive: true });
      mkdirSync(join(workspace, "public/.well-known"), { recursive: true });
      writeFileSync(
        join(workspace, "src/forge/_generated/authRegistry.json"),
        JSON.stringify({
          defaultMode: "dev-headers",
          requiresTenant: true,
          claims: { userId: "sub", tenantId: "organization_id", permissions: "permissions" },
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/secretRegistry.json"),
        JSON.stringify({
          secrets: [
            { name: "WORKOS_API_KEY" },
            { name: "WORKOS_CLIENT_ID" },
            { name: "WORKOS_COOKIE_PASSWORD" },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/policyRegistry.json"),
        JSON.stringify({
          policies: [
            { name: "vendors:read", permissions: ["vendors:read"] },
            { name: "access:approve", permissions: ["access:approve"] },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/dataGraph.json"),
        JSON.stringify({
          tables: [
            { name: "organizations", fields: [{ name: "id" }] },
            { name: "vendors", fields: [{ name: "tenantId" }] },
            { name: "accessRequests", fields: [{ name: "tenantId" }] },
          ],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/agentContract.json"),
        JSON.stringify({ auth: { requiresTenant: true } }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "workos-seed.yml"),
        [
          "permissions:",
          "  - slug: vendors:read",
          "  - slug: access:approve",
          "roles:",
          "  - slug: owner",
          "    permissions:",
          "      - vendors:read",
          "      - access:approve",
          "  - slug: auditor",
          "    permissions:",
          "      - vendors:read",
          "resource_types:",
          "  - slug: organization",
          "  - slug: vendor",
          "  - slug: accessRequest",
          "organizations:",
          "  - name: Acme Corp",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(join(workspace, "public/auth.md"), "# auth.md\n", "utf8");
      writeFileSync(join(workspace, "public/.well-known/oauth-protected-resource"), "{}\n", "utf8");

      const parsed = parseCli(["auth", "prove", "--scenario", "multi-tenant", "--json"]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command).toMatchObject({ kind: "auth", subcommand: "prove", scenario: "multi-tenant" });

      const result = await runAuthCommand({
        subcommand: "prove",
        workspaceRoot: workspace,
        json: true,
        scenario: "multi-tenant",
      });
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        kind: "auth-proof",
        scenario: "multi-tenant",
        multiTenantProof: { ok: true },
      });
      expect(JSON.stringify(result.data)).toContain("vendors:read");
      expect(JSON.stringify(result.data)).toContain("access:approve");
      expect(JSON.stringify(result.data)).not.toContain("onboarding:read");
      expect(JSON.stringify(result.data)).toContain("node bin/forge.mjs workos doctor --json");
      expect(JSON.stringify(result.data)).not.toContain("\"forge workos doctor --json\"");

      const check = await runAuthCommand({
        subcommand: "check",
        workspaceRoot: workspace,
        json: true,
      });
      expect(JSON.stringify(check.data)).toContain("node bin/forge.mjs auth prove --prod --token <jwt> --json");
      expect(JSON.stringify(check.data)).not.toContain("\"forge auth prove --prod --token <jwt> --json\"");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("test authz proves generated tenant and policy contract", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-test-authz-"));
    try {
      mkdirSync(join(workspace, "src/forge/_generated"), { recursive: true });
      writeFileSync(
        join(workspace, "src/forge/_generated/policyRegistry.json"),
        JSON.stringify({
          policies: [
            { name: "vendors:read", kind: "permissions", permissions: ["vendors:read"], roles: [], file: "src/policies.ts", symbolId: "p1" },
            { name: "access:approve", kind: "permissions", permissions: ["access:approve"], roles: [], file: "src/policies.ts", symbolId: "p2" },
          ],
          commandAuth: [
            { commandName: "approveAccess", file: "src/commands/approveAccess.ts", symbolId: "c1", auth: { kind: "policy", policy: "access:approve" } },
          ],
          queryAuth: [
            { queryName: "listVendors", file: "src/queries/listVendors.ts", symbolId: "q1", auth: { kind: "policy", policy: "vendors:read" } },
          ],
          diagnostics: [],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/tenantScope.json"),
        JSON.stringify({
          tables: [{ table: "vendors", exportName: "vendors", tenantIdColumn: "organization_id", file: "src/forge/schema.ts" }],
          diagnostics: [],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/capabilityMap.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          generatorVersion: "test",
          project: { name: "vendor-access", type: "forgeos-app" },
          summary: { covered: 1, backendOnly: 0, frontendOnly: 0, warnings: 0 },
          entries: [
            {
              id: "approveAccess",
              status: "covered",
              userAction: "Approve vendor access",
              runtime: {
                kind: "command",
                name: "approveAccess",
                hook: "useCommand",
                http: { method: "POST", path: "/commands/approveAccess" },
                policy: "access:approve",
                tablesRead: ["vendors"],
                tablesWritten: ["vendors"],
                emits: [],
                dependencies: [{ table: "vendors", scope: "tenant" }],
              },
              notes: [],
            },
          ],
          diagnostics: [],
        }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "src/forge/_generated/agentContract.json"),
        JSON.stringify({ auth: { requiresTenant: true } }),
        "utf8",
      );

      const result = await runTestCommand({
        subcommand: "authz",
        workspaceRoot: workspace,
        json: true,
        write: false,
        changed: false,
        staged: false,
        maxCost: "standard",
        includeDocker: false,
        includeBrowser: false,
        bail: false,
        tenant: "acme",
        otherTenant: "globex",
      });

      expect(result.exitCode).toBe(0);
      expect(result.authz?.summary).toMatchObject({
        ok: true,
        tenantScopedTables: 1,
        protectedCommands: 1,
        protectedQueries: 1,
        capabilityPolicyBindings: 1,
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio attach dry-run plans the target app preview and agent setup", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-attach-"));
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", forge: { template: "minimal-web" } }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex", "claude"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.app.name).toBe("customer-app");
      expect(result.app.template).toBe("minimal-web");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.preview.source).toBe("preview-port");
      expect(result.preview.isStudioSelfPreview).toBe(false);
      expect(result.preview.status).toMatchObject({
        state: "not-checked",
        checked: false,
      });
      expect(result.preview.status.suggestedCommands).toContain("forge dev --port 3766 --web-port 5174");
      expect(result.posture).toMatchObject({
        checked: false,
        state: "not-checked",
      });
      expect(result.posture.recommendedCommands).toContain("forge dev --once --json");
      expect(result.filesPlanned).toContain(".forge/studio/attachment.json");
      expect(result.filesWritten).toEqual([]);
      expect(result.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5174");
      expect(result.commands.startTargetAppCwd).toBe(workspace.replace(/\\/g, "/"));
      expect(result.commands.openPreview).toBe("http://127.0.0.1:5174");
      expect(result.commands.probePreview).toBe("forge dev --once --json");
      expect(result.commands.installHooks).toContain("forge agent onboard --target codex --json");
      expect(result.commands.installHooks).toContain("forge agent onboard --target claude --json");

      const avoided = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5173,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(avoided.ok).toBe(true);
      expect(avoided.preview).toMatchObject({
        url: "http://127.0.0.1:5174",
        port: 5174,
        requestedUrl: "http://127.0.0.1:5173",
        requestedPort: 5173,
        source: "studio-avoid-self-preview",
        isStudioSelfPreview: true,
      });
      expect(avoided.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_SELF_PREVIEW_AVOIDED")).toBe(true);
      expect(avoided.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5174");
      expect(avoided.commands.openPreview).toBe("http://127.0.0.1:5174");
      expect(avoided.preview.status.state).toBe("not-checked");

      const forced = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewUrl: "http://127.0.0.1:5173",
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: true,
      });
      expect(forced.preview).toMatchObject({
        url: "http://127.0.0.1:5173",
        port: 5173,
        source: "explicit-url",
        isStudioSelfPreview: true,
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio attach records ForgeOS posture for real attached apps", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-attach-posture");
    try {
      const result = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: [],
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.filesWritten).toContain(".forge/studio/attachment.json");
      expect(result.posture).toMatchObject({
        checked: true,
        state: "ready",
        safeToEdit: true,
      });
      expect(result.posture.generated?.state).toMatch(/fresh|regenerated/);
      expect(result.posture.diffPlan).toMatchObject({
        first: "authored",
        then: "generated",
        authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
      });
      const manifest = JSON.parse(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).text()) as {
        posture?: typeof result.posture;
      };
      expect(manifest.posture?.generated?.state).toBe(result.posture.generated?.state);
      expect(manifest.posture?.diffPlan?.fullDiffCommand).toBe("git diff");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("studio open dry-run plans attach, preview automation, and bridge", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-open-"));
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", packageManager: "npm@10.0.0", forge: { template: "minimal-web" } }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("open");
      expect(result.attach.action).toBe("attach");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        skippedReason: "dry-run",
      });
      expect(result.previewAutomation.install).toMatchObject({
        required: true,
        installed: false,
        attempted: false,
        command: "npm install",
      });
      expect(result.bridge).toMatchObject({
        attempted: true,
        ok: true,
        posted: false,
        dryRun: true,
        studioUrl: "http://127.0.0.1:3765",
      });
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5174 --target codex --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json");
      expect(result.nextActions).toContain("npm install");
      expect(result.nextActions).toContain("forge dev --port 3766 --web-port 5174");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio open does not start preview when dependencies are missing without install consent", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-open-missing-deps-"));
    const listener = await listenOnRandomPort();
    const previewPort = listener.port;
    await listener.close();
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", packageManager: "bun@1.3.14" }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort,
        targets: ["codex"],
        bridge: false,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(false);
      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        skippedReason: "missing-dependencies",
      });
      expect(result.previewAutomation.install).toMatchObject({
        required: true,
        installed: false,
        attempted: false,
        command: "bun install",
      });
      expect(result.bridge.attempted).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_DEPENDENCIES_MISSING")).toBe(true);
      expect(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).exists()).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio open reuses a live target preview process instead of spawning a duplicate", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-open-preview-state");
    const reserved = await listenOnRandomPort();
    const previewPort = reserved.port;
    await reserved.close();
    try {
      mkdirSync(join(workspace, ".forge", "studio"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "studio", "preview.json"),
        `${JSON.stringify({
          pid: process.pid,
          command: `forge dev --port 3766 --web-port ${previewPort}`,
          previewPort,
          runtimePort: 3766,
          startedAt: new Date(0).toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort,
        targets: ["codex"],
        bridge: false,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        alreadyRunning: true,
        skippedReason: "already-running",
        pid: process.pid,
        owner: {
          kind: "forge-managed",
          pid: process.pid,
          statePath: ".forge/studio/preview.json",
        },
      });
      expect(result.previewAutomation.statusAfter.state).toBe("not-running");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot reports preview posture and changed state without writing manifest", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-snapshot");
    try {
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("snapshot");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.posture).toMatchObject({
        checked: true,
        state: "needs-attention",
        safeToEdit: false,
      });
      expect(result.posture.generated?.state).toBe("stale-risk");
      expect(Number((result.changed.summary as { changedFiles?: number }).changedFiles)).toBeGreaterThanOrEqual(0);
      expect(result.changed.diffPlan).toMatchObject({
        first: "authored",
        then: "generated",
      });
      expect(result.contextPacket.commands).toContain("forge changed --json");
      expect(result.handoff).toMatchObject({
        previewUrl: "http://127.0.0.1:5174",
        generatedState: "stale-risk",
        agentContextCommand: "forge agent context --handoff --json",
      });
      expect(result.handoff.recommendedCommands).toContain("forge agent context --handoff --json");
      expect(result.proofs.hooks[0]?.target).toBe("codex");
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5174 --target codex --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json");
      expect(result.commands.doctor).toBe("forge studio doctor . --preview-port 5174 --target codex --json");
      expect(result.nextActions).toContain("forge changed --json");
      expect(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).exists()).toBe(false);

      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
      const localResult = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(localResult.commands.changed).toBe("node bin/forge.mjs changed --json");
      expect(localResult.commands.doctor).toBe("node bin/forge.mjs studio doctor . --preview-port 5174 --target codex --json");
      expect(localResult.nextActions).toContain("node bin/forge.mjs changed --json");
      expect(JSON.stringify(localResult)).not.toContain("\"forge changed --json\"");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("studio snapshot exposes Codex app-server proof without requiring it", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-app-server");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.proofs.codexAppServer).toMatchObject({
        checked: true,
        relevant: true,
        state: "disabled",
        available: false,
      });
      expect(result.commands.codexAppServer?.inspect).toBe("codex app-server --help");
      expect(result.commands.codexAppServer?.generateTypes).toBe("codex app-server generate-ts --out .forge/codex-app-server-schemas");
      expect(result.contextPacket.commands).toContain("codex app-server --help");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot can include Codex app-server handshake proof when requested", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-app-server-probe");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        probeAppServer: true,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.proofs.codexAppServer).toMatchObject({
        checked: true,
        relevant: true,
        state: "disabled",
        available: false,
        handshake: {
          attempted: false,
          ok: true,
          initialized: false,
          skippedReason: "disabled",
        },
      });
      expect(result.commands.bridge).toContain("--probe-codex-server");
      expect(result.commands.doctor).toContain("--probe-codex-server");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio codex-server reports the optional app-server surface directly", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-server-command");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioCodexServerCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("codex-server");
      expect(result.proof.state).toBe("disabled");
      expect(result.schemaGeneration).toMatchObject({
        attempted: false,
        dryRun: true,
        ok: true,
      });
      expect(result.handshake).toMatchObject({
        attempted: false,
        ok: true,
        skippedReason: "not-requested",
      });
      expect(result.commands.connectStdio).toBe("codex app-server");
      expect(result.commands.probeHandshake).toBe("forge studio codex-server . --probe --json");
      expect(result.nextActions).toContain("codex app-server --help");
      expect(result.nextActions).toContain("forge studio codex-server . --probe --json");

      mkdirSync(join(workspace, "bin"), { recursive: true });
      writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");
      const localResult = await runStudioCodexServerCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(localResult.commands.probeHandshake).toBe("node bin/forge.mjs studio codex-server . --probe --json");
      expect(localResult.nextActions).toContain("node bin/forge.mjs studio codex-server . --probe --json");
      expect(JSON.stringify(localResult)).not.toContain("\"forge studio codex-server . --probe --json\"");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio codex-server --probe skips cleanly when app-server probing is disabled", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-server-probe-disabled");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioCodexServerCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        probeAppServer: true,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.handshake).toMatchObject({
        attempted: false,
        dryRun: false,
        ok: true,
        skippedReason: "disabled",
        initialized: false,
      });
      expect(result.nextActions).not.toContain("forge studio codex-server . --probe --json");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot reuses existing attachment preview and targets", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-snapshot-attachment");
    try {
      mkdirSync(join(workspace, ".forge", "studio"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "studio", "attachment.json"),
        `${JSON.stringify({
          schemaVersion: "0.1.0",
          preview: {
            url: "http://127.0.0.1:5199",
            port: 5199,
            source: "preview-port",
            isStudioSelfPreview: false,
            note: "Attached preview",
            status: {
              state: "not-checked",
              checked: false,
              reason: "seeded",
              suggestedCommands: [],
            },
          },
          targets: ["codex", "claude"],
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.preview.url).toBe("http://127.0.0.1:5199");
      expect(result.preview.port).toBe(5199);
      expect(result.targets).toEqual(["codex", "claude"]);
      expect(result.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5199");
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5199 --target codex --target claude --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5199 --target codex --target claude --studio-url http://127.0.0.1:3765 --json");
      expect(result.commands.checkHooks).toContain("forge agent hooks status --target claude --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot tolerates ready non-git workspaces", async () => {
    const sourceWorkspace = scaffoldGenerateWorkspace("forge-studio-snapshot-no-git");
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-snapshot-no-git-"));
    cpSync(sourceWorkspace, workspace, { recursive: true, force: true });
    cleanupWorkspace(sourceWorkspace);
    try {
      rmSync(join(workspace, ".git"), { recursive: true, force: true });
      const attach = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: false,
        force: false,
      });
      expect(attach.ok).toBe(true);
      rmSync(join(workspace, ".git"), { recursive: true, force: true });

      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.posture.state).toBe("ready");
      expect((result.changed.git as { available?: boolean }).available).toBe(false);
      expect(result.changed.risks).toContain(
        "git status is unavailable; using filesystem inventory as untracked-file analysis",
      );
      expect(result.ok).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio bridge dry-run collects and prepares a Studio ingest snapshot", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-bridge");
    try {
      const result = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: true,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("bridge");
      expect(result.mode).toBe("once");
      expect(result.studioUrl).toBe("http://127.0.0.1:3765");
      expect(result.endpoint).toBe("http://127.0.0.1:3765/commands/ingestStudioSnapshot");
      expect(result.provider).toBe("Codex");
      expect(result.target).toBe("codex");
      expect(result.intervalMs).toBe(2000);
      expect(result.posted).toBe(false);
      expect(result.dryRun).toBe(true);
      expect(result.snapshot.action).toBe("snapshot");
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_BRIDGE_DRY_RUN")).toBe(true);

      const implicitOnce = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: false,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(implicitOnce.mode).toBe("once");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio watch dry-run emits a single snapshot event", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-watch-dry-run");
    try {
      const result = await runStudioWatchCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        intervalMs: 2000,
        once: false,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.action).toBe("watch");
      expect(result.stream.mode).toBe("once");
      expect(result.stream.dryRun).toBe(true);
      expect(result.stream.intervalMs).toBe(2000);
      expect(result.snapshot.action).toBe("snapshot");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio bridge posts with Forge Studio local dev auth defaults", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-bridge-auth");
    const originalFetch = globalThis.fetch;
    const originalTenant = process.env.FORGE_TENANT_ID;
    const originalUser = process.env.FORGE_USER_ID;
    const originalRole = process.env.FORGE_ROLE;
    let capturedHeaders: Headers | undefined;
    let capturedBody: Record<string, any> | undefined;

    try {
      delete process.env.FORGE_TENANT_ID;
      delete process.env.FORGE_USER_ID;
      delete process.env.FORGE_ROLE;

      globalThis.fetch = (async (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
        return new Response(JSON.stringify({ ok: true, result: { workspaceId: "workspace_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const result = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: true,
        targets: ["codex"],
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.posted).toBe(true);
      expect(capturedHeaders?.get("x-forge-tenant-id")).toBe("00000000-0000-4000-8000-000000000001");
      expect(capturedHeaders?.get("x-forge-user-id")).toBe("forge-studio-dev");
      expect(capturedHeaders?.get("x-forge-role")).toBe("owner");
      expect(capturedBody?.args?.provider).toBe("Codex");
      expect(capturedBody?.args?.snapshot?.action).toBe("snapshot");
      expect(capturedBody?.args?.bridge).toMatchObject({
        mode: "once",
        intervalMs: 2000,
        status: "received",
      });
      expect(typeof capturedBody?.args?.bridge?.postedAt).toBe("string");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTenant === undefined) delete process.env.FORGE_TENANT_ID;
      else process.env.FORGE_TENANT_ID = originalTenant;
      if (originalUser === undefined) delete process.env.FORGE_USER_ID;
      else process.env.FORGE_USER_ID = originalUser;
      if (originalRole === undefined) delete process.env.FORGE_ROLE;
      else process.env.FORGE_ROLE = originalRole;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio preview probe reports local preview reachability", async () => {
    const listener = await listenOnRandomPort();
    try {
      const reachable = await probeStudioPreview(
        {
          url: `http://127.0.0.1:${listener.port}`,
          port: listener.port,
          source: "preview-port",
          isStudioSelfPreview: false,
          note: "test preview",
        },
        { dryRun: false, startCommand: `forge dev --web-port ${listener.port}`, timeoutMs: 500 },
      );
      expect(reachable).toMatchObject({
        state: "reachable",
        checked: true,
      });
    } finally {
      await listener.close();
    }

    const notChecked = await probeStudioPreview(
      {
        url: "https://example.com",
        source: "explicit-url",
        isStudioSelfPreview: false,
        note: "remote preview",
      },
      { dryRun: false, startCommand: "forge dev --web-port 5174", timeoutMs: 50 },
    );
    expect(notChecked).toMatchObject({
      state: "not-checked",
      checked: false,
    });
  });

  test("parseCli accepts explicit full inspect", () => {
    const parsed = parseCli(["inspect", "all", "--full", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("inspect");
    if (parsed.command?.kind === "inspect") {
      expect(parsed.command.target).toBe("all");
      expect(parsed.command.full).toBe(true);
    }

    const brief = parseCli(["inspect", "all", "--brief", "--json"]);
    expect(brief.errors).toEqual([]);
    expect(brief.command?.kind).toBe("inspect");
    if (brief.command?.kind === "inspect") {
      expect(brief.command.target).toBe("all");
      expect(brief.command.brief).toBe(true);
    }
  });

  test("parseCli accepts delta repair preview and confirmation flags", () => {
    const preview = parseCli(["delta", "repair", "--dry-run", "--json"]);
    expect(preview.errors).toEqual([]);
    expect(preview.command?.kind).toBe("delta");
    if (preview.command?.kind === "delta") {
      expect(preview.command.subcommand).toBe("repair");
      expect(preview.command.dryRun).toBe(true);
      expect(preview.command.yes).toBe(false);
      expect(preview.command.verbose).toBe(false);
    }

    const apply = parseCli(["delta", "repair", "--yes", "--json"]);
    expect(apply.errors).toEqual([]);
    expect(apply.command?.kind).toBe("delta");
    if (apply.command?.kind === "delta") {
      expect(apply.command.subcommand).toBe("repair");
      expect(apply.command.yes).toBe(true);
    }

    const compact = parseCli(["delta", "compact", "--dry-run", "--json"]);
    expect(compact.errors).toEqual([]);
    expect(compact.command).toMatchObject({
      kind: "delta",
      subcommand: "compact",
      dryRun: true,
      json: true,
    });

    const prune = parseCli(["delta", "prune", "--older-than", "30d", "--yes", "--json"]);
    expect(prune.errors).toEqual([]);
    expect(prune.command).toMatchObject({
      kind: "delta",
      subcommand: "prune",
      olderThan: "30d",
      yes: true,
      json: true,
    });

    const exported = parseCli(["delta", "export", "--redacted", "--output", ".forge/delta/export.json", "--limit", "25", "--json"]);
    expect(exported.errors).toEqual([]);
    expect(exported.command).toMatchObject({
      kind: "delta",
      subcommand: "export",
      redacted: true,
      output: ".forge/delta/export.json",
      limit: 25,
      json: true,
    });
  });

  test("parseCli accepts release doctor and prepared-only gates", () => {
    const releaseDoctor = parseCli(["release", "doctor", "--json"]);
    expect(releaseDoctor.errors).toEqual([]);
    expect(releaseDoctor.command).toMatchObject({ kind: "release", action: "doctor", json: true });

    const releaseCheck = parseCli(["release", "check", "--allow-missing-local-release", "--json"]);
    expect(releaseCheck.errors).toEqual([]);
    expect(releaseCheck.command?.kind).toBe("release");
    if (releaseCheck.command?.kind === "release") {
      expect(releaseCheck.command.allowMissingLocalRelease).toBe(true);
    }

    const selfHost = parseCli(["self-host", "check", "--prepared-only", "--json"]);
    expect(selfHost.errors).toEqual([]);
    expect(selfHost.command?.kind).toBe("self-host");
    if (selfHost.command?.kind === "self-host") {
      expect(selfHost.command.preparedOnly).toBe(true);
    }

    const docs = parseCli(["docs", "check", "--build", "--install-venv", "--json"]);
    expect(docs.errors).toEqual([]);
    expect(docs.command?.kind).toBe("docs");
    if (docs.command?.kind === "docs") {
      expect(docs.command.build).toBe(true);
      expect(docs.command.installVenv).toBe(true);
    }
  });

  test("release doctor separates npm publish blockers from production deploy blockers", async () => {
    const workspace = scaffoldGenerateWorkspace("release-doctor-deploy-production");
    try {
      const parsed = parseCli(["release", "doctor", "--json"]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("release");
      if (parsed.command?.kind !== "release") {
        throw new Error("expected release command");
      }

      const result = await runReleaseDoctorCommand({
        ...parsed.command,
        workspaceRoot: workspace,
      });
      const deploy = result.checks.find((check) => check.name === "deploy-production");
      expect(deploy).toBeDefined();
      expect(deploy?.requiredForPublish).toBe(false);
      expect(deploy?.requiredForProduction).toBe(true);
      expect(result.summary.productionBlockers).toContain("deploy-production");
      expect(result.summary.publishBlockers).not.toContain("deploy-production");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("parseCli accepts agent prepare, hook smoke, and db doctor", () => {
    const prepare = parseCli(["agent", "prepare", "--target", "codex", "--json"]);
    expect(prepare.errors).toEqual([]);
    expect(prepare.command?.kind).toBe("agent");
    if (prepare.command?.kind === "agent") {
      expect(prepare.command.options.subcommand).toBe("prepare");
      expect(prepare.command.options.target).toBe("codex");
    }

    const hooks = parseCli(["agent", "hooks", "smoke", "--json"]);
    expect(hooks.errors).toEqual([]);
    expect(hooks.command?.kind).toBe("agent");
    if (hooks.command?.kind === "agent") {
      expect(hooks.command.options.subcommand).toBe("hooks");
      expect(hooks.command.options.hookAction).toBe("smoke");
      expect(hooks.command.options.target).toBe("codex");
    }

    const hookStatus = parseCli(["agent", "hooks", "status", "--target", "claude", "--json"]);
    expect(hookStatus.errors).toEqual([]);
    expect(hookStatus.command?.kind).toBe("agent");
    if (hookStatus.command?.kind === "agent") {
      expect(hookStatus.command.options.subcommand).toBe("hooks");
      expect(hookStatus.command.options.hookAction).toBe("status");
      expect(hookStatus.command.options.target).toBe("claude");
    }

    const onboard = parseCli(["agent", "onboard", "--json"]);
    expect(onboard.errors).toEqual([]);
    expect(onboard.command?.kind).toBe("agent");
    if (onboard.command?.kind === "agent") {
      expect(onboard.command.options.subcommand).toBe("onboard");
      expect(onboard.command.options.target).toBe("codex");
    }

    const db = parseCli(["db", "doctor", "--json"]);
    expect(db.errors).toEqual([]);
    expect(db.command?.kind).toBe("db");
    if (db.command?.kind === "db") {
      expect(db.command.subcommand).toBe("doctor");
    }

    const doctorAgent = parseCli(["doctor", "agent", "--target", "cursor", "--json"]);
    expect(doctorAgent.errors).toEqual([]);
    expect(doctorAgent.command?.kind).toBe("doctor");
    if (doctorAgent.command?.kind === "doctor") {
      expect(doctorAgent.command.target).toBe("agent");
      expect(doctorAgent.command.agentTarget).toBe("cursor");
    }

    const doctorDelta = parseCli(["doctor", "delta", "--json"]);
    expect(doctorDelta.errors).toEqual([]);
    expect(doctorDelta.command).toMatchObject({
      kind: "doctor",
      target: "delta",
      json: true,
    });

    const doctorRuntime = parseCli(["doctor", "runtime", "--json"]);
    expect(doctorRuntime.errors).toEqual([]);
    expect(doctorRuntime.command).toMatchObject({
      kind: "doctor",
      target: "runtime",
      json: true,
    });

    const ingestWatch = parseCli([
      "agent",
      "ingest",
      "codex",
      "--watch",
      "--file",
      ".forge/agent/events.ndjson",
      "--poll-interval",
      "500",
      "--json",
    ]);
    expect(ingestWatch.errors).toEqual([]);
    expect(ingestWatch.command?.kind).toBe("agent");
    if (ingestWatch.command?.kind === "agent") {
      expect(ingestWatch.command.options.subcommand).toBe("ingest");
      expect(ingestWatch.command.options.target).toBe("codex");
      expect(ingestWatch.command.options.watch).toBe(true);
      expect(ingestWatch.command.options.file).toBe(".forge/agent/events.ndjson");
      expect(ingestWatch.command.options.pollIntervalMs).toBe(500);
    }
  });

  test("hasUnknownOption flags unrecognized options", () => {
    expect(hasUnknownOption(["generate", "--nope"])).toBe("--nope");
    expect(hasUnknownOption(["generate", "--check"])).toBeNull();
    expect(hasUnknownOption(["add", "lucide-react", "--frontend"])).toBeNull();
    expect(hasUnknownOption(["add", "hono", "--backend"])).toBeNull();
  });

  test("parseCli accepts verify profile aliases", () => {
    const quick = parseCli(["verify", "quick", "--json"]);
    expect(quick.errors).toEqual([]);
    expect(quick.command?.kind).toBe("verify");
    if (quick.command?.kind === "verify") {
      expect(quick.command.options.fast).toBe(true);
    }

    const agent = parseCli(["verify", "agent", "--json"]);
    expect(agent.errors).toEqual([]);
    expect(agent.command?.kind).toBe("verify");
    if (agent.command?.kind === "verify") {
      expect(agent.command.options.standard).toBe(true);
    }

    const release = parseCli(["verify", "release", "--json"]);
    expect(release.errors).toEqual([]);
    expect(release.command?.kind).toBe("verify");
    if (release.command?.kind === "verify") {
      expect(release.command.options.strict).toBe(true);
      expect(release.command.options.internal).toBe(false);
    }

    const framework = parseCli(["verify", "framework", "--json"]);
    expect(framework.errors).toEqual([]);
    expect(framework.command?.kind).toBe("verify");
    if (framework.command?.kind === "verify") {
      expect(framework.command.options.strict).toBe(true);
      expect(framework.command.options.internal).toBe(true);
    }

    const unknown = parseCli(["verify", "banana", "--json"]);
    expect(unknown.errors).toContain(
      "unknown forge verify profile 'banana'; expected quick, smoke, agent, standard, release, strict, changed, framework, internal, or maintainer",
    );
  });

  test("parseCli accepts auth status/prod and ui audit", () => {
    const auth = parseCli(["auth", "prove", "--prod", "--token", "abc", "--json"]);
    expect(auth.errors).toEqual([]);
    expect(auth.command?.kind).toBe("auth");
    if (auth.command?.kind === "auth") {
      expect(auth.command.subcommand).toBe("prove");
      expect(auth.command.prod).toBe(true);
      expect(auth.command.token).toBe("abc");
    }

    const status = parseCli(["auth", "status", "--json"]);
    expect(status.errors).toEqual([]);
    expect(status.command?.kind).toBe("auth");

    const audit = parseCli(["ui", "audit", "--json"]);
    expect(audit.errors).toEqual([]);
    expect(audit.command?.kind).toBe("ui");
    if (audit.command?.kind === "ui") {
      expect(audit.command.options.subcommand).toBe("audit");
    }
  });

  test("auth check --production rejects local dev headers", async () => {
    const workspace = scaffoldGenerateWorkspace("auth-check-production");
    try {
      const result = await runAuthCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        json: true,
        prod: true,
      });
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.error?.code).toBe("FORGE_AUTH_MODE_INVALID");
      expect(JSON.stringify(result.data)).toContain("dev-headers");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("main returns exit 1 for unrecognized command", async () => {
    const code = await main(["not-a-command"]);
    expect(code).toBe(1);
  });

  test("main prints focused help for empty command", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(output).toContain("forge dev --once --json");
      expect(output).toContain("forge do \"fix\" --json");
      expect(output).toContain("forge doctor windows --json");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints JSON CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output) as { version?: string; cliVersion?: string };
      expect(parsed.version).toBe(parsed.cliVersion);
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main accepts version command alias with JSON output", async () => {
    const parsed = parseCli(["version", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toEqual({ kind: "version", json: true });

    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["version", "--json"]);
      expect(code).toBe(0);
      const body = JSON.parse(output) as { version?: string; cliVersion?: string };
      expect(body.version).toBe(body.cliVersion);
      expect(body.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("parseCli accepts verify with skip flags", () => {
    const parsed = parseCli([
      "verify",
      "--json",
      "--skip-tests",
      "--skip-eslint",
      "--smoke",
      "--script-timeout-ms",
      "1234",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("verify");
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.skipTests).toBe(true);
      expect(parsed.command.options.skipEslint).toBe(true);
      expect(parsed.command.options.smoke).toBe(true);
      expect(parsed.command.options.scriptTimeoutMs).toBe(1234);
    }
  });

  test("parseCli accepts verify typechecker, test jobs, test plan, and compiler bench", () => {
    const verify = parseCli(["verify", "--typechecker", "native", "--test-jobs", "3", "--test-plan", "--json"]);
    expect(verify.errors).toEqual([]);
    expect(verify.command?.kind).toBe("verify");
    if (verify.command?.kind === "verify") {
      expect(verify.command.options.typechecker).toBe("native");
      expect(verify.command.options.testJobs).toBe(3);
      expect(verify.command.options.testPlan).toBe(true);
    }

    const ts7 = parseCli(["verify", "--typechecker", "ts7", "--json"]);
    expect(ts7.errors).toEqual([]);
    expect(ts7.command?.kind).toBe("verify");
    if (ts7.command?.kind === "verify") {
      expect(ts7.command.options.typechecker).toBe("ts7");
    }

    const bench = parseCli(["bench", "compiler", "--json", "--iterations", "2", "--warmups", "0", "--concurrency", "3"]);
    expect(bench.errors).toEqual([]);
    expect(bench.command?.kind).toBe("bench");
    if (bench.command?.kind === "bench") {
      expect(bench.command.options.iterations).toBe(2);
      expect(bench.command.options.warmups).toBe(0);
      expect(bench.command.options.concurrency).toBe(3);
    }
  });

  test("strict TestGraph jobs are bounded and configurable", () => {
    expect(chunkFiles(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(resolveStrictTestJobs({ requested: 99, chunkCount: 3 })).toBe(3);
    expect(resolveStrictTestJobs({ requested: 1, chunkCount: 3 })).toBe(1);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "not-a-number" }, chunkCount: 1 })).toBe(1);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 5 })).toBe(4);
    expect(resolveStrictIsolatedTestJobs({ env: { FORGE_VERIFY_ISOLATED_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 3 })).toBe(3);
  });

  test("strict TestGraph weighted chunks balance slow files", () => {
    const chunks = packWeightedStrictTestChunks(
      [
        { file: "slow-a.test.ts", estimatedMs: 10_000, durationSource: "profile" },
        { file: "slow-b.test.ts", estimatedMs: 9_000, durationSource: "profile" },
        { file: "fast-a.test.ts", estimatedMs: 500, durationSource: "fallback" },
        { file: "fast-b.test.ts", estimatedMs: 500, durationSource: "fallback" },
      ],
      2,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks[1]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks.some((chunk) => chunk.files.includes("slow-a.test.ts") && chunk.files.includes("slow-b.test.ts"))).toBe(false);
  });

  test("strict TestGraph plan is available without running tests", () => {
    const plan = buildStrictTestGraphPlan(process.cwd(), 3, {});
    expect(plan.fileCount).toBeGreaterThan(0);
    expect(plan.chunkCount).toBeGreaterThan(0);
    expect(plan.totalJobs).toBeLessThanOrEqual(3);
    expect(plan.laneMode).toBe("overlap");
    expect(plan.jobs + plan.isolatedJobs).toBeLessThanOrEqual(plan.totalJobs);
    expect(plan.jobs).toBeGreaterThan(0);
    expect(plan.isolatedJobs).toBeGreaterThan(0);
    expect(plan.lanes.serial.chunkCount).toBe(0);
    expect(plan.slowestFiles.length).toBeGreaterThan(0);

    const singleWorkerPlan = buildStrictTestGraphPlan(process.cwd(), 1, {});
    expect(singleWorkerPlan.totalJobs).toBe(1);
    expect(singleWorkerPlan.laneMode).toBe("sequential");
    expect(singleWorkerPlan.jobs).toBe(1);
    expect(singleWorkerPlan.isolatedJobs).toBe(1);
  }, 20_000);

  test("strict TestGraph lanes isolate global-heavy tests without serializing them", () => {
    expect(classifyStrictTestFile("tests/client/client-query.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/db/pglite-adapter.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/dev/server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-bridge.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-cli.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-node-cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/go-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/java-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-generation.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/cli/node-compat-dev-server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat-new.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify-changed.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner-diagnostics.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-artifacts.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-self-host.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-apply.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-bindings.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/security/tenant-isolation/http-runtime.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/templates/create-forge-app.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/classifier/classify.test.ts")).toBe("parallel");
  });

  test("parseCli accepts impact test timeout", () => {
    const parsed = parseCli(["test", "run", "--changed", "--timeout-ms", "77", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("test");
    if (parsed.command?.kind === "test") {
      expect(parsed.command.options.timeoutMs).toBe(77);
    }
  });

  test("resolveBunExecutable ignores extensionless Windows PATH entries", () => {
    const kiroShim = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable ignores Kiro-Cli Windows bun executables", () => {
    const kiroExe = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun || path === kiroExe,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroExe,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable normalizes Windows bun shims with an exe sibling", () => {
    const bunShim = "C:\\Users\\David\\.bun\\bin\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => bunShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable refuses ambiguous Windows bun fallback", () => {
    expect(() => resolveBunExecutable({
      env: {},
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: () => false,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe",
    })).toThrow("Unable to resolve a safe Bun executable on Windows");
  });

  test("resolveBunExecutable honors explicit FORGE_BUN", () => {
    const realBun = "D:\\Tools\\bun\\bun.exe";
    const resolved = resolveBunExecutable({
      env: { FORGE_BUN: realBun },
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => null,
    });

    expect(resolved).toBe(realBun);
  });

  test("parseCli accepts dev with port and watch flags", () => {
    const parsed = parseCli(["dev", "--port", "4000", "--watch", "--mock", "--db", "memory", "--skip-startup-console", "--seed"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind === "dev") {
      expect(parsed.command.port).toBe(4000);
      expect(parsed.command.watch).toBe(true);
      expect(parsed.command.mock).toBe(true);
      expect(parsed.command.db).toBe("memory");
      expect(parsed.command.skipStartupConsole).toBe(true);
      expect(parsed.command.seed).toBe(true);
    }
  });

  test("parseCli accepts pglite doctor and db repair aliases", () => {
    const last = parseCli(["last", "--json"]);
    expect(last.errors).toEqual([]);
    expect(last.command?.kind).toBe("last");
    if (last.command?.kind === "last") {
      expect(last.command.json).toBe(true);
    }

    const doctor = parseCli(["doctor", "pglite", "--json"]);
    expect(doctor.errors).toEqual([]);
    expect(doctor.command?.kind).toBe("doctor");
    if (doctor.command?.kind === "doctor") {
      expect(doctor.command.target).toBe("pglite");
      expect(doctor.command.json).toBe(true);
    }

    const repair = parseCli(["db", "repair", "--local", "--adapter", "pglite", "--json"]);
    expect(repair.errors).toEqual([]);
    expect(repair.command?.kind).toBe("db");
    if (repair.command?.kind === "db") {
      expect(repair.command.subcommand).toBe("repair");
      expect(repair.command.db).toBe("pglite");
      expect(repair.command.local).toBe(true);
      expect(repair.command.json).toBe(true);
    }
  });

  test("runtime doctor reports generated and local DB posture", async () => {
    const workspace = scaffoldGenerateWorkspace("runtime-doctor");
    try {
      await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      const result = await runRuntimeDoctorCommand({ workspaceRoot: workspace });
      expect(result.ok).toBe(true);
      expect(result.checks.map((check) => check.name)).toContain("generated");
      expect(result.checks.map((check) => check.name)).toContain("pglite-store");
      expect(result.dbGuide.recommendedForCurrentState).toBe("pglite");
      expect(result.dbGuide.memory.command).toBe("forge dev --db memory --json");
      expect(result.dbGuide.memory.useWhen).toContain("you need a clean isolated smoke test");
      expect(result.dbGuide.pglite.command).toBe("forge dev --db pglite --json");
      expect(result.nextActions).toContain("forge dev --once --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("pglite doctor explains when to use memory versus pglite", async () => {
    const workspace = scaffoldGenerateWorkspace("pglite-doctor-db-guide");
    try {
      const result = await runPgliteDoctorCommand({ workspaceRoot: workspace });
      expect(result.ok).toBe(true);
      expect(result.dbGuide.recommendedForCurrentState).toBe("pglite");
      expect(result.dbGuide.memory.command).toBe("forge dev --db memory --json");
      expect(result.dbGuide.pglite.command).toBe("forge dev --db pglite --json");
      expect(result.dbGuide.pglite.useWhen).toContain("doctor pglite reports the store is missing or healthy");
      expect(result.dbGuide.repair).toBeUndefined();
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("runtime doctor does not suggest pglite repair for generated-only drift", async () => {
    const workspace = scaffoldGenerateWorkspace("runtime-doctor-generated-only");
    try {
      await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      writeFileSync(join(workspace, "src", "forge", "_generated", "appGraph.json"), "{\"stale\":true}\n", "utf8");
      const result = await runRuntimeDoctorCommand({ workspaceRoot: workspace });
      expect(result.ok).toBe(false);
      expect(result.nextActions).toContain("forge generate");
      expect(result.nextActions).not.toContain("forge db repair --local --adapter pglite --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

});
