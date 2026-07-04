import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runGoldenPathCommand } from "../../src/forge/cli/golden-path.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import { cleanupWorkspace, defaultGenerateOptions, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

function writeMinimalWorkOSArtifacts(workspace: string): void {
  mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
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
    join(workspace, "src/forge/_generated/policyRegistry.json"),
    JSON.stringify({ policies: [{ name: "vendors.read", permissions: ["vendors:read"] }] }),
    "utf8",
  );
  writeFileSync(
    join(workspace, "src/forge/_generated/dataGraph.json"),
    JSON.stringify({ tables: [{ name: "vendors", fields: [{ name: "tenantId" }] }] }),
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
    'import { canPermission } from "forge/policy"; export const policies = { "vendors.read": canPermission("vendors:read") };\n',
    "utf8",
  );
  writeFileSync(
    join(workspace, "workos-seed.yml"),
    [
      "permissions:",
      "  - slug: 'vendors:read'",
      "resource_types:",
      "  - slug: 'organization'",
      "  - slug: 'vendor'",
      "roles:",
      "  - slug: 'owner'",
      "organizations:",
      "  - name: 'Acme Corp'",
      "config:",
      "  redirect_uris:",
      "    - 'http://localhost:5173'",
      "    - 'http://localhost:5173/callback'",
      "  cors_origins:",
      "    - 'http://localhost:5173'",
      "  homepage_url: 'http://localhost:5173'",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"), 'export const config = { provider: "workos" }; export function verifyWorkOSWebhook() {} export function handleWorkOSWebhook() {}\n', "utf8");
  writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"), 'export const workosAuthHttpRoutes = ["/login", "/callback", "/logout", "/session"]; export function handleWorkOSAuthRequest() {}\n', "utf8");
  writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/session.ts"), "export function encodeWorkOSSession() {} export function decodeWorkOSSession() {} export function workOSSessionToClaims() {}\n", "utf8");
  writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"), 'export const workosWebhookHttpRoute = { path: "/webhooks/workos" }; export function handleWorkOSWebhookRequest() {}\n', "utf8");
  writeFileSync(
    join(workspace, "web/src/lib/workos-auth.tsx"),
    [
      "export function ForgeProvider() {}",
      "function workOSApiUrl(path: string) { return path; }",
      "function forgeTenantIdForWorkOSOrganization(claims: any) { return claims?.tenant_id ?? claims?.organization_id; }",
      "function workOSSessionToForgeAuth(session: any) {",
      "  const claims = session?.claims;",
      "  const forgeTenantId = forgeTenantIdForWorkOSOrganization(claims);",
      "  return { userId: claims?.sub, tenantId: forgeTenantId, organizationId: forgeTenantId, role: claims?.role, permissions: claims.permissions, claims };",
      "}",
      "const workOSAuthProvider = async () => workOSSessionToForgeAuth({ claims: { sub: 'user_test', organization_id: 'tenant_test', permissions: ['vendors:read'] } });",
      "export function ForgeWorkOSAuthProvider() { return <ForgeProvider auth={workOSAuthProvider} />; }",
      "export function useForgeWorkOSSession() { return fetch(workOSApiUrl('/session'), { credentials: 'include' }).then((response) => response.json()).then((session) => session.claims); }",
      "export function useWorkOSAuth() { return { signIn: () => workOSApiUrl('/login'), signOut: () => workOSApiUrl('/logout') }; }",
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(workspace, "web/vite.config.ts"),
    "export default { server: { proxy: { '/login': 'http://127.0.0.1:3765', '/callback': 'http://127.0.0.1:3765', '/logout': 'http://127.0.0.1:3765', '/session': 'http://127.0.0.1:3765' } } };\n",
    "utf8",
  );
  writeFileSync(
    join(workspace, "web/src/main.tsx"),
    "import { ForgeWorkOSAuthProvider } from './lib/workos-auth'; export const root = ForgeWorkOSAuthProvider;\n",
    "utf8",
  );
}

describe("forge golden-path", () => {
  test("parseCli accepts the official WorkOS Docker path", () => {
    const parsed = parseCli([
      "golden-path",
      "status",
      "--auth",
      "workos",
      "--target",
      "docker",
      "--forge-spec",
      "npm:forgeos@alpha",
      "--client-id",
      "client_parse",
      "--real",
      "--production",
      "--json",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "golden-path",
      subcommand: "status",
      auth: "workos",
      target: "docker",
      forgeSpec: "npm:forgeos@alpha",
      clientId: "client_parse",
      real: true,
      production: true,
      template: "vendor-access",
      packageManager: "npm",
    });
  });

  test("parseCli rejects unknown golden-path subcommands", () => {
    const parsed = parseCli(["golden-path", "stats", "--json"]);
    expect(parsed.command).toBeNull();
    expect(parsed.errors.join("\n")).toContain("plan or status");
  });

  test("plan returns a single create-auth-field-test-deploy command ladder", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-plan");
    try {
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "plan",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        forgeSpec: "file:/tmp/forgeos",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        json: true,
      });

      expect(result.ok).toBe(true);
      expect(result.stages.map((stage) => stage.id)).toEqual(["create", "auth", "field-test", "deploy"]);
      expect(result.nextActions).toContain("forge field-test create vendor-access --auth workos --template vendor-access --package-manager npm --forge-spec file:/tmp/forgeos --install --git --json");
      expect(result.nextActions).toContain("npm run forge -- workos env --client-id client_... --write --json");
      expect(result.nextActions).toContain("npm run forge -- workos setup --real --file workos-seed.yml --json");
      expect(result.nextActions).toContain("npm run forge -- auth prove --provider workos --real --client-id client_... --file workos-seed.yml --json");
      expect(result.nextActions).toContain("npm run forge -- field-test run --realistic --json");
      expect(result.nextActions).toContain("npm run forge -- deploy readiness --production --json");
      expect(result.nextActions).toContain("npm run forge -- deploy check --production --json");
      expect(result.nextActions).toContain("npm run forge -- deploy verify --production --url https://app.example.com --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("plan uses a supplied WorkOS client id instead of placeholder commands", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-plan-client-id");
    try {
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "plan",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        clientId: "client_plan",
        json: true,
      });

      expect(result.ok).toBe(true);
      expect(result.nextActions).toContain("npm run forge -- workos env --client-id client_plan --write --json");
      expect(result.nextActions).toContain("npm run forge -- auth prove --provider workos --real --client-id client_plan --file workos-seed.yml --json");
      expect(result.nextActions.join("\n")).not.toContain("client_...");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status reports the first blocking stage and deploy blockers", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-status");
    try {
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "status",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        json: true,
      });

      expect(result.ok).toBe(false);
      expect(result.summary.canPublish).toBe(false);
      expect(result.summary.currentStage).toBe("auth");
      expect(result.summary.nextCommand).toBe("forge workos doctor --json");
      expect(result.summary.blockers.join("\n")).toContain("workos-doctor");
      expect(result.summary.blockers.join("\n")).toContain("database-url");
      expect(result.stages.find((stage) => stage.id === "deploy")?.status).toBe("blocked");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status blocks real WorkOS auth until hosted seed evidence matches the current seed", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-real-workos-seed");
    try {
      writeMinimalWorkOSArtifacts(workspace);
      writeFileSync(
        join(workspace, ".env.local"),
        [
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_AUDIENCE=client_test",
          "FORGE_AUTH_JWKS_URI=https://api.workos.com/sso/jwks/client_test",
          "WORKOS_CLIENT_ID=client_test",
          "WORKOS_COOKIE_PASSWORD=abcdefghijklmnopqrstuvwxyz123456",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "status",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        json: true,
      });

      expect(result.ok).toBe(false);
      expect(result.checks?.workos?.exitCode).toBe(0);
      expect(result.summary.currentStage).toBe("auth");
      expect(result.summary.nextCommand).toBe("forge auth prove --provider workos --real --file workos-seed.yml --json");
      expect(result.summary.blockers.join("\n")).toContain("workos-real-seed");
      expect(Object.keys(result.checks?.fieldTest ?? {})).toEqual([
        "ok",
        "kind",
        "action",
        "summary",
        "reportPath",
        "nextActions",
        "exitCode",
      ]);
      expect(JSON.stringify(result.checks?.fieldTest)).not.toContain("stdout");
      expect(result.stages.find((stage) => stage.id === "auth")).toMatchObject({
        status: "blocked",
        nextCommand: "forge auth prove --provider workos --real --file workos-seed.yml --json",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status asks for WorkOS env before hosted seed proof when real env is missing", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-real-workos-env");
    try {
      writeMinimalWorkOSArtifacts(workspace);
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "status",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        json: true,
      });

      expect(result.ok).toBe(false);
      expect(result.checks?.workos?.exitCode).toBe(0);
      expect(result.checks?.workosEnv?.exitCode).toBe(1);
      expect(result.summary.currentStage).toBe("auth");
      expect(result.summary.nextCommand).toBe("forge workos env --client-id client_... --write --json");
      expect(result.summary.blockers.join("\n")).toContain("workos-env");
      expect(result.summary.blockers.join("\n")).toContain("--client-id client_...");
      expect(JSON.stringify(result.stages.find((stage) => stage.id === "auth")?.evidence)).toContain("WORKOS_CLIENT_ID");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status uses supplied WorkOS client id to skip placeholder env blocker", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-real-workos-client-id");
    try {
      writeMinimalWorkOSArtifacts(workspace);
      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "status",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "workos",
        target: "docker",
        production: true,
        real: true,
        clientId: "client_status",
        json: true,
      });

      expect(result.ok).toBe(false);
      expect(result.checks?.workos?.exitCode).toBe(0);
      expect(result.checks?.workosEnv?.exitCode).toBe(0);
      expect(result.summary.currentStage).toBe("auth");
      expect(result.summary.nextCommand).toBe("forge auth prove --provider workos --real --client-id client_status --file workos-seed.yml --json");
      expect(result.summary.blockers.join("\n")).toContain("workos-real-seed");
      expect(result.summary.blockers.join("\n")).not.toContain("workos-env");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("status describes manual deploy env edits as next action instead of run command", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-golden-path-manual-deploy-action");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      writeFileSync(join(workspace, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }), "utf8");
      mkdirSync(join(workspace, ".forge"), { recursive: true });
      mkdirSync(join(workspace, "deploy"), { recursive: true });
      mkdirSync(join(workspace, "public/.well-known"), { recursive: true });
      writeFileSync(join(workspace, ".forge/field-test-report.json"), JSON.stringify({ ok: true }), "utf8");
      writeFileSync(join(workspace, "public/auth.md"), "# Auth\n", "utf8");
      writeFileSync(
        join(workspace, "public/.well-known/oauth-protected-resource"),
        JSON.stringify({ resource: "https://app.acme.internal" }),
        "utf8",
      );
      writeFileSync(
        join(workspace, "deploy/.env.production"),
        [
          "DATABASE_URL=postgres://forge:forge@postgres:5432/forge_app",
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://api.workos.com",
          "FORGE_AUTH_AUDIENCE=client_test_local",
          "FORGE_AUTH_JWKS_URI=https://api.workos.com/sso/jwks/client_test_local",
          "",
        ].join("\n"),
        "utf8",
      );

      const result = await runGoldenPathCommand({
        workspaceRoot: workspace,
        subcommand: "status",
        name: "vendor-access",
        template: "vendor-access",
        packageManager: "npm",
        auth: "none",
        target: "docker",
        production: true,
        real: false,
        json: true,
      });

      expect(result.summary.currentStage).toBe("deploy");
      expect(result.summary.nextCommand).toBe("edit deploy/.env.production with real production values");
      expect(result.summary.blockers.join("\n")).toContain("next action: edit deploy/.env.production with real production values");
      expect(result.summary.blockers.join("\n")).not.toContain("run edit deploy/.env.production");
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
