import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runDeployCommand } from "../../src/forge/cli/deploy.ts";
import { collectWorkOSFgaManifest } from "../../src/forge/cli/workos.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";

describe("forge deploy", () => {
  test("parseCli accepts production deploy commands", () => {
    const check = parseCli(["deploy", "check", "--production", "--target", "docker", "--json"]);
    expect(check.errors).toEqual([]);
    expect(check.command).toMatchObject({
      kind: "deploy",
      subcommand: "check",
      target: "docker",
      production: true,
      json: true,
    });

    const render = parseCli(["deploy", "render", "docker"]);
    expect(render.errors).toEqual([]);
    expect(render.command).toMatchObject({
      kind: "deploy",
      subcommand: "render",
      target: "docker",
    });

    const packaged = parseCli(["deploy", "package", "--target", "docker", "--json"]);
    expect(packaged.errors).toEqual([]);
    expect(packaged.command).toMatchObject({
      kind: "deploy",
      subcommand: "package",
      target: "docker",
    });

    const verify = parseCli(["deploy", "verify", "--url", "https://app.example.test", "--json"]);
    expect(verify.errors).toEqual([]);
    expect(verify.command).toMatchObject({
      kind: "deploy",
      subcommand: "verify",
      url: "https://app.example.test",
    });
  });

  test("plan returns production gates and repo-local commands", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-plan");
    try {
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "plan",
        target: "docker",
        production: true,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.plan?.gates).toContain("auth mode is jwt or oidc");
      expect(result.nextActions).toContain("forge deploy check --production --json");
      expect(result.nextActions).toContain("forge deploy verify --production --url https://app.example.com --json");
      expect(result.nextActions).toContain("forge deploy package --target docker");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("render writes Docker production deploy files", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-render");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      expect(result.ok).toBe(true);
      expect(result.files).toContain("deploy/docker-compose.yml");
      expect(existsSync(join(workspace, "deploy", "docker-compose.yml"))).toBe(true);
      const compose = readFileSync(join(workspace, "deploy", "docker-compose.yml"), "utf8");
      expect(compose).toContain("env_file:\n      - .env.production");
      expect(compose).toContain("npm run forge -- serve --host 0.0.0.0 --port 3765");
      expect(compose).not.toContain("DATABASE_URL: postgres://forge:forge@postgres:5432/forge_app");
      const dockerfile = readFileSync(join(workspace, "deploy", "Dockerfile.runtime"), "utf8");
      expect(dockerfile).toContain("COPY package.json");
      expect(dockerfile).toContain("RUN npm install");
      expect(dockerfile).toContain("RUN npm run forge -- generate");
      const env = readFileSync(join(workspace, "deploy", ".env.production.example"), "utf8");
      expect(env).toContain("FORGE_AUTH_MODE=oidc");
      expect(env).toContain("DATABASE_URL=");
      const readme = readFileSync(join(workspace, "deploy", "README.production.md"), "utf8");
      expect(readme).toContain("forge deploy check --production --json");
      expect(readme).toContain("forge deploy package --target docker");
      expect(readme).toContain("reads this file as deploy evidence");
      expect(readme).toContain("does not inject a hidden `DATABASE_URL` override");
      expect(readme).toContain("A template file alone is not enough");
      expect(readme).toContain("forge auth prove --scenario multi-tenant --json");
      expect(readme).toContain("forge auth prove --prod --token <jwt> --json");
      expect(readme).toContain("forge deploy verify --production --url https://app.example.com --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("render uses the detected package manager for Docker commands", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-render-pnpm");
    try {
      const pkgPath = join(workspace, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      writeFileSync(pkgPath, JSON.stringify({ ...pkg, packageManager: "pnpm@9.0.0" }, null, 2), "utf8");
      writeFileSync(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
      await runGenerate(defaultGenerateOptions(workspace));
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      expect(result.ok).toBe(true);
      const compose = readFileSync(join(workspace, "deploy", "docker-compose.yml"), "utf8");
      expect(compose).toContain("pnpm run forge -- serve --host 0.0.0.0 --port 3765");
      expect(compose).not.toContain('"npm", "run", "forge"');
      const dockerfile = readFileSync(join(workspace, "deploy", "Dockerfile.runtime"), "utf8");
      expect(dockerfile).toContain("COPY package.json pnpm-lock.yaml ./");
      expect(dockerfile).toContain("RUN corepack enable");
      expect(dockerfile).toContain("RUN pnpm install --frozen-lockfile");
      expect(dockerfile).toContain("RUN pnpm run forge -- generate");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("render falls back to non-frozen install when the package manager lockfile is absent", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-render-pnpm-no-lock");
    try {
      const pkgPath = join(workspace, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
      writeFileSync(pkgPath, JSON.stringify({ ...pkg, packageManager: "pnpm@9.0.0" }, null, 2), "utf8");
      await runGenerate(defaultGenerateOptions(workspace));
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      expect(result.ok).toBe(true);
      const dockerfile = readFileSync(join(workspace, "deploy", "Dockerfile.runtime"), "utf8");
      expect(dockerfile).toContain("COPY package.json ./");
      expect(dockerfile).toContain("RUN pnpm install");
      expect(dockerfile).not.toContain("RUN pnpm install --frozen-lockfile");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("production check requires real database env evidence, not only the example file", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-db-evidence");
    const originalDatabaseUrl = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      await runGenerate(defaultGenerateOptions(workspace));
      await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      const withoutRealEnv = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      const databaseWithoutRealEnv = withoutRealEnv.checks.find((check) => check.name === "database-url");
      expect(databaseWithoutRealEnv).toMatchObject({
        ok: false,
        severity: "error",
      });
      expect(databaseWithoutRealEnv?.message).toContain("only a template");
      expect(withoutRealEnv.nextActions).toContain("cp deploy/.env.production.example deploy/.env.production");

      writeFileSync(join(workspace, "deploy", ".env.production"), "DATABASE_URL=postgres://example\n", "utf8");
      const withRealEnv = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      expect(withRealEnv.checks.find((check) => check.name === "database-url")).toMatchObject({
        ok: true,
        message: "DATABASE_URL is set in deploy/.env.production",
      });
    } finally {
      if (originalDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = originalDatabaseUrl;
      }
      cleanupWorkspace(workspace);
    }
  });

  test("production check reads auth settings from deploy env file", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-auth-env-file");
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      FORGE_AUTH_MODE: process.env.FORGE_AUTH_MODE,
      FORGE_AUTH_ISSUER: process.env.FORGE_AUTH_ISSUER,
      FORGE_AUTH_AUDIENCE: process.env.FORGE_AUTH_AUDIENCE,
      FORGE_AUTH_JWKS_URI: process.env.FORGE_AUTH_JWKS_URI,
    };
    try {
      delete process.env.DATABASE_URL;
      delete process.env.FORGE_AUTH_MODE;
      delete process.env.FORGE_AUTH_ISSUER;
      delete process.env.FORGE_AUTH_AUDIENCE;
      delete process.env.FORGE_AUTH_JWKS_URI;
      await runGenerate(defaultGenerateOptions(workspace));
      await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      writeFileSync(
        join(workspace, "deploy", ".env.production"),
        [
          "DATABASE_URL=postgres://forge:forge@postgres:5432/forge_app",
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://issuer.example.test",
          "FORGE_AUTH_AUDIENCE=forge-api",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      expect(result.checks.find((check) => check.name === "production-auth-mode")).toMatchObject({
        ok: true,
        message: "auth mode oidc is production-capable",
      });
      expect(result.checks.find((check) => check.name === "auth-issuer")).toMatchObject({ ok: true });
      expect(result.checks.find((check) => check.name === "auth-audience")).toMatchObject({ ok: true });
      expect(result.checks.find((check) => check.name === "database-url")).toMatchObject({ ok: true });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      cleanupWorkspace(workspace);
    }
  });

  test("production check reports env sources without treating .env.local as deploy evidence", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-env-sources");
    const saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      FORGE_AUTH_MODE: process.env.FORGE_AUTH_MODE,
      FORGE_AUTH_ISSUER: process.env.FORGE_AUTH_ISSUER,
      FORGE_AUTH_AUDIENCE: process.env.FORGE_AUTH_AUDIENCE,
      FORGE_AUTH_JWKS_URI: process.env.FORGE_AUTH_JWKS_URI,
    };
    try {
      delete process.env.DATABASE_URL;
      delete process.env.FORGE_AUTH_MODE;
      delete process.env.FORGE_AUTH_ISSUER;
      delete process.env.FORGE_AUTH_AUDIENCE;
      delete process.env.FORGE_AUTH_JWKS_URI;
      await runGenerate(defaultGenerateOptions(workspace));
      await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "render",
        target: "docker",
        production: true,
        json: true,
      });
      writeFileSync(
        join(workspace, ".env.local"),
        [
          "DATABASE_URL=postgres://local-only",
          "FORGE_AUTH_MODE=oidc",
          "FORGE_AUTH_ISSUER=https://local-only.example.test",
          "FORGE_AUTH_AUDIENCE=local-forge-api",
          "",
        ].join("\n"),
        "utf8",
      );
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      const sourceCheck = result.checks.find((check) => check.name === "deploy-env-sources");
      expect(sourceCheck).toMatchObject({
        ok: true,
        message: "deploy/.env.production and process.env are production deploy evidence; .env/.env.local are local guidance only",
      });
      expect(JSON.stringify(sourceCheck?.details)).toContain('"path":".env.local"');
      expect(JSON.stringify(sourceCheck?.details)).toContain('"readForProduction":false');
      expect(JSON.stringify(sourceCheck?.details)).toContain('"FORGE_AUTH_MODE"');
      expect(result.checks.find((check) => check.name === "production-auth-mode")).toMatchObject({
        ok: false,
      });
      expect(result.checks.find((check) => check.name === "database-url")).toMatchObject({
        ok: false,
      });
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
      cleanupWorkspace(workspace);
    }
  });

  test("check aggregates generated, auth, and auth.md readiness", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-check");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      const checkNames = result.checks.map((check) => check.name);
      expect(checkNames).toContain("generated");
      expect(checkNames).toContain("package-lockfile");
      expect(checkNames).toContain("production-auth-mode");
      expect(checkNames).toContain("auth-md-check");
      expect(checkNames).toContain("auth-tenant-proof");
      expect(checkNames).toContain("field-test-report");
      expect(result.checks.find((check) => check.name === "auth-tenant-proof")).toMatchObject({
        ok: true,
        severity: "warning",
      });
      expect(result.checks.find((check) => check.name === "package-lockfile")).toMatchObject({
        ok: false,
        severity: "error",
      });
      expect(result.nextActions).toContain("npm install");
      expect(result.checks.find((check) => check.name === "auth-md")?.severity).toBe("error");
      expect(result.checks.find((check) => check.name === "oauth-protected-resource")?.severity).toBe("error");
      expect(result.checks.find((check) => check.name === "field-test-report")?.severity).toBe("error");
      expect(result.nextActions).toContain("forge authmd generate --json");
      expect(result.nextActions).toContain("forge field-test run --realistic --json");
      expect(result.exitCode).toBe(1);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check summarizes field-test evidence when present", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-field-report");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      mkdirSync(join(workspace, ".forge"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "field-test-report.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          uiProbes: true,
          results: [
            {
              ok: true,
              template: "minimal-web",
              packageManager: "npm",
              steps: [
                { ok: true, command: "npm run forge -- add auth workos --json" },
                { ok: true, command: "npm run forge -- authmd generate --json" },
                { ok: true, command: "npm run forge -- authmd check --json" },
                { ok: true, command: "npm run forge -- workos doctor --json" },
                { ok: true, command: "npm run forge -- workos seed --file workos-seed.yml --dry-run --json" },
                { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --scenario multi-tenant --json" },
              ],
              uiErgonomics: { ok: true, warnings: 0, errors: 0, diagnosticCodes: [] },
              runtime: {
                steps: [
                  { ok: true, command: "GET /health" },
                  { ok: true, command: "GET /entries" },
                  { ok: true, command: "GET http://127.0.0.1:5173/" },
                  { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                  { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                  { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                  { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                ],
              },
            },
          ],
        }),
        "utf8",
      );
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      const fieldReport = result.checks.find((check) => check.name === "field-test-report");
      expect(fieldReport).toMatchObject({
        ok: true,
        severity: "error",
      });
      expect(JSON.stringify(fieldReport?.details)).toContain(".forge/field-test-report.json");
      expect(JSON.stringify(fieldReport?.details)).toContain('"runtimeProbeSteps":7');
      expect(JSON.stringify(fieldReport?.details)).toContain('"authSetupProbeSteps":7');
      expect(JSON.stringify(fieldReport?.details)).toContain('"authMetadataProbeSteps":4');
      expect(JSON.stringify(fieldReport?.details)).toContain('"uiProbeSteps":1');
      expect(JSON.stringify(fieldReport?.details)).toContain('"uiErgonomics":true');
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("production check requires WorkOS hosted seed evidence when WorkOS is present", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-workos-hosted-seed");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      mkdirSync(join(workspace, "src/forge/_generated/integrations/workos"), { recursive: true });
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
      const seedYaml = [
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
        "    - 'http://localhost:5173/callback'",
        "  cors_origins:",
        "    - 'http://localhost:5173'",
        "  homepage_url: 'http://localhost:5173'",
        "",
      ].join("\n");
      writeFileSync(join(workspace, "workos-seed.yml"), seedYaml, "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/webhook.ts"), 'export const config = { provider: "workos" }; export function verifyWorkOSWebhook() {} export function handleWorkOSWebhook() {}\n', "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/auth-routes.ts"), 'export const workosAuthHttpRoutes = ["/login", "/callback", "/logout", "/session"]; export function handleWorkOSAuthRequest() {}\n', "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/session.ts"), "export function encodeWorkOSSession() {} export function decodeWorkOSSession() {} export function workOSSessionToClaims() {}\n", "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/http-handler.ts"), 'export const workosWebhookHttpRoute = { path: "/webhooks/workos" }; export function handleWorkOSWebhookRequest() {}\n', "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/resource-map.ts"), 'export class ForgeWorkOSFgaDecisionCache {} export function canWorkOS() { return { permissionSlug: "x", resourceExternalId: "y" }; } export function syncWorkOSResourceGraph() {} export function workOSResourceRecords() {} export function assertWorkOSResourceTenant() { throw new Error("FORGE_WORKOS_CROSS_TENANT_RESOURCE"); }\n', "utf8");
      writeFileSync(join(workspace, "src/forge/_generated/integrations/workos/fga.ts"), 'export const forgeWorkOSResourceTypes = [{ slug: "organization" }, { slug: "vendor" }];\n', "utf8");

      const missingState = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      expect(missingState.checks.find((check) => check.name === "workos-hosted-seed")).toMatchObject({
        ok: false,
        severity: "error",
        command: "forge workos prove --real --file workos-seed.yml --json",
      });
      expect(missingState.checks.find((check) => check.name === "workos-fga-proof")).toMatchObject({
        ok: false,
        severity: "error",
        command: "forge workos fga prove --real --file workos-seed.yml --json",
      });
      expect(missingState.nextActions).toContain("forge workos fga plan --file workos-seed.yml --write --json");
      expect(missingState.nextActions).toContain("forge workos fga sync --real --file workos-seed.yml --json");
      expect(missingState.nextActions).toContain("forge workos fga prove --real --file workos-seed.yml --json");

      writeFileSync(
        join(workspace, ".workos-seed-state.json"),
        `${JSON.stringify({
          schemaVersion: "0.1.0",
          provider: "workos",
          kind: "seed-state",
          seedFile: "workos-seed.yml",
          seedHash: createHash("sha256").update(seedYaml).digest("hex"),
          appliedAt: "2026-07-02T00:00:00.000Z",
          alreadyApplied: true,
        }, null, 2)}\n`,
        "utf8",
      );

      const withState = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      expect(withState.checks.find((check) => check.name === "workos-hosted-seed")).toMatchObject({
        ok: true,
        severity: "error",
      });
      expect(withState.checks.find((check) => check.name === "workos-fga-proof")).toMatchObject({
        ok: false,
        severity: "error",
      });
      expect(withState.nextActions).toContain("forge workos fga plan --file workos-seed.yml --write --json");
      expect(withState.nextActions).toContain("forge workos fga sync --real --file workos-seed.yml --json");

      const fgaManifest = collectWorkOSFgaManifest(workspace, "workos-seed.yml");
      writeFileSync(
        join(workspace, ".workos-fga-state.json"),
        `${JSON.stringify({
          schemaVersion: "0.1.0",
          provider: "workos",
          kind: "fga-state",
          mode: "real",
          seedFile: "workos-seed.yml",
          seedHash: fgaManifest.seedHash,
          manifestHash: fgaManifest.manifestHash,
          syncedAt: "2026-07-02T00:00:00.000Z",
          provedAt: "2026-07-02T00:00:00.000Z",
          sdkOk: true,
          resourceTypes: fgaManifest.resourceTypes,
          resources: fgaManifest.resources,
          proofScenarios: fgaManifest.proofScenarios,
        }, null, 2)}\n`,
        "utf8",
      );
      mkdirSync(join(workspace, "deploy"), { recursive: true });
      writeFileSync(
        join(workspace, "deploy/.env.production"),
        [
          'WORKOS_FGA_MEMBERSHIPS_JSON={"Acme Corp":"om_acme"}',
          "",
        ].join("\n"),
        "utf8",
      );

      const withFgaState = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });
      expect(withFgaState.checks.find((check) => check.name === "workos-fga-proof")).toMatchObject({
        ok: true,
        severity: "error",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("production check warns when field-test UI ergonomics has warnings", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-field-report-ui-warnings");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      mkdirSync(join(workspace, ".forge"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "field-test-report.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          uiProbes: true,
          results: [
            {
              ok: true,
              template: "minimal-web",
              packageManager: "npm",
              uiErgonomics: {
                ok: true,
                warnings: 2,
                errors: 0,
                diagnosticCodes: ["FORGE_UI_PRIMARY_ACTION_MISSING", "FORGE_UI_WORKFLOW_NAV_MISSING"],
              },
              steps: [
                { ok: true, command: "npm run forge -- add auth workos --json" },
                { ok: true, command: "npm run forge -- authmd generate --json" },
                { ok: true, command: "npm run forge -- authmd check --json" },
                { ok: true, command: "npm run forge -- workos doctor --json" },
                { ok: true, command: "npm run forge -- workos seed --file workos-seed.yml --dry-run --json" },
                { ok: true, command: "npm run forge -- workos prove --file workos-seed.yml --json" },
              { ok: true, command: "npm run forge -- auth prove --scenario multi-tenant --json" },
              ],
              runtime: {
                steps: [
                  { ok: true, command: "GET /health" },
                  { ok: true, command: "GET /entries" },
                  { ok: true, command: "GET http://127.0.0.1:5173/" },
                  { ok: true, command: "HEAD http://127.0.0.1:3765/auth.md" },
                  { ok: true, command: "GET http://127.0.0.1:3765/auth.md" },
                  { ok: true, command: "HEAD http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                  { ok: true, command: "GET http://127.0.0.1:3765/.well-known/oauth-protected-resource" },
                ],
              },
            },
          ],
        }),
        "utf8",
      );

      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });

      const fieldReport = result.checks.find((check) => check.name === "field-test-report");
      const uiErgonomics = result.checks.find((check) => check.name === "field-test-ui-ergonomics");
      expect(fieldReport?.ok).toBe(true);
      expect(uiErgonomics).toMatchObject({
        ok: false,
        severity: "warning",
        command: "forge inspect ui --ergonomics --json",
      });
      expect(uiErgonomics?.message).toContain("2 warning");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("production check blocks field-test reports without UI probes", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-field-report-no-ui");
    try {
      await runGenerate(defaultGenerateOptions(workspace));
      mkdirSync(join(workspace, ".forge"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "field-test-report.json"),
        JSON.stringify({
          ok: true,
          runtimeProbes: true,
          authProbes: true,
          results: [
            {
              ok: true,
              template: "minimal-web",
              packageManager: "npm",
              runtime: { steps: [{ ok: true, command: "GET /health" }, { ok: true, command: "GET /entries" }] },
            },
          ],
        }),
        "utf8",
      );

      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "check",
        target: "docker",
        production: true,
        json: true,
      });

      const fieldReport = result.checks.find((check) => check.name === "field-test-report");
      expect(fieldReport).toMatchObject({
        ok: false,
        severity: "error",
        command: "forge field-test run --realistic --json",
      });
      expect(fieldReport?.message).toContain("missing deploy evidence");
      expect(fieldReport?.message).toContain("ui probes");
      expect(fieldReport?.message).toContain("auth setup probes");
      expect(fieldReport?.message).toContain("auth metadata endpoint probes");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("verify probes health and public auth metadata with HEAD and GET", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-verify");
    const originalFetch = globalThis.fetch;
    const calls: Array<{ method: string; url: string }> = [];
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        calls.push({ method, url });
        const isMetadata = url.endsWith("oauth-protected-resource");
        const isAuthMd = url.endsWith("/auth.md");
        return new Response(method === "HEAD" ? "" : isMetadata ? "{}" : isAuthMd ? "# auth.md\n" : "", {
          status: 200,
          headers: {
            "content-type": isMetadata ? "application/json" : isAuthMd ? "text/markdown" : "text/plain",
          },
        });
      }) as typeof fetch;
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "verify",
        target: "docker",
        production: true,
        url: "https://app.example.test",
        json: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.probes?.map((probe) => `${probe.method} ${probe.url.replace("https://app.example.test", "")}`)).toEqual([
        "GET /health",
        "HEAD /auth.md",
        "GET /auth.md",
        "HEAD /.well-known/oauth-protected-resource",
        "GET /.well-known/oauth-protected-resource",
      ]);
      expect(calls.length).toBe(5);
      expect(result.probes?.find((probe) => probe.url.endsWith("oauth-protected-resource") && probe.method === "GET")).toMatchObject({
        ok: true,
        jsonValid: true,
      });
    } finally {
      globalThis.fetch = originalFetch;
      cleanupWorkspace(workspace);
    }
  });

  test("production verify fails when protected-resource metadata is not valid JSON", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-deploy-verify-json");
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        const isMetadata = url.endsWith("oauth-protected-resource");
        const isAuthMd = url.endsWith("/auth.md");
        return new Response(method === "HEAD" ? "" : isMetadata ? "not-json" : isAuthMd ? "# auth.md\n" : "", {
          status: 200,
          headers: {
            "content-type": isMetadata ? "application/json" : isAuthMd ? "text/markdown" : "text/plain",
          },
        });
      }) as typeof fetch;
      const result = await runDeployCommand({
        workspaceRoot: workspace,
        subcommand: "verify",
        target: "docker",
        production: true,
        url: "https://app.example.test",
        json: true,
      });
      expect(result.exitCode).toBe(1);
      expect(result.probes?.find((probe) => probe.url.endsWith("oauth-protected-resource") && probe.method === "GET")).toMatchObject({
        ok: false,
        jsonValid: false,
      });
      expect(result.checks.find((check) => check.name === "GET /.well-known/oauth-protected-resource")).toMatchObject({
        ok: false,
        severity: "error",
      });
    } finally {
      globalThis.fetch = originalFetch;
      cleanupWorkspace(workspace);
    }
  });
});
