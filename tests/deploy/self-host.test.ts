import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runBuildCommand } from "../../src/forge/cli/build.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import { runSelfHostCommand } from "../../src/forge/cli/self-host.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function read(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

async function scaffoldSupportApp(prefix: string): Promise<{
  workspace: string;
  project: string;
}> {
  const workspace = tempWorkspace(prefix);
  const created = await runNewCommand({
    name: "support-app",
    template: "b2b-support-web",
    packageManager: "bun",
    install: false,
    git: false,
    workspaceRoot: workspace,
  });
  expect(created.exitCode).toBe(0);

  const project = join(workspace, "support-app");
  const generated = await runGenerateCommand({
    workspaceRoot: project,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 2,
  });
  expect(generated.exitCode).toBe(0);

  return { workspace, project };
}

describe("self-host deploy packaging", () => {
  test("parseCli accepts H18 commands", () => {
    expect(parseCli(["build"]).command).toMatchObject({ kind: "build" });
    expect(
      parseCli(["serve", "--host", "0.0.0.0", "--port", "3765"]).command,
    ).toMatchObject({ kind: "serve", host: "0.0.0.0", port: 3765 });
    expect(
      parseCli(["worker", "--db", "postgres", "--once", "--poll-interval", "500"]).command,
    ).toMatchObject({ kind: "worker", db: "postgres", once: true, pollIntervalMs: 500 });
    expect(
      parseCli(["self-host", "compose", "--runtime-port", "4567", "--web-port", "3001"]).command,
    ).toMatchObject({
      kind: "self-host",
      subcommand: "compose",
      runtimePort: 4567,
      webPort: 3001,
    });
  });

  test("self-host compose writes deploy artifacts", async () => {
    const { workspace, project } = await scaffoldSupportApp("h18-compose");
    try {
      const result = await runSelfHostCommand({
        subcommand: "compose",
        workspaceRoot: project,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(project, "deploy", "docker-compose.yml"))).toBe(true);
      expect(existsSync(join(project, "deploy", "Dockerfile.runtime"))).toBe(true);
      expect(existsSync(join(project, "deploy", "Dockerfile.web"))).toBe(true);
      expect(existsSync(join(project, "deploy", ".dockerignore"))).toBe(true);
      expect(existsSync(join(project, "deploy", ".env.example"))).toBe(true);
      expect(existsSync(join(project, "deploy", "README.md"))).toBe(true);

      const compose = read(project, "deploy/docker-compose.yml");
      expect(compose).toContain("postgres:");
      expect(compose).toContain("forge-migrate:");
      expect(compose).toContain("forge-runtime:");
      expect(compose).toContain("forge-worker:");
      expect(compose).toContain("web:");
      expect(compose).toContain('"worker", "--db", "postgres"');

      expect(read(project, "deploy/Dockerfile.runtime")).toContain("FROM oven/bun:1");
      expect(read(project, "deploy/Dockerfile.web")).toContain(".next/standalone");
      expect(read(project, "deploy/.dockerignore")).toContain(".env");
      expect(read(project, "deploy/.env.example")).toContain("DATABASE_URL=");
      expect(read(project, "deploy/.env.example")).toContain("NEXT_PUBLIC_FORGE_URL=");
      expect(read(project, "deploy/.env.example")).toContain("STRIPE_SECRET_KEY=");
      expect(read(project, "deploy/README.md")).toContain("FORGE_AUTH_MODE=dev-headers");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("self-host env and check validate generated deploy state", async () => {
    const { workspace, project } = await scaffoldSupportApp("h18-check");
    try {
      const env = await runSelfHostCommand({
        subcommand: "env",
        workspaceRoot: project,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });
      expect(env.exitCode).toBe(0);
      expect(read(project, "deploy/.env.example")).toContain("AI_GATEWAY_API_KEY=");

      const missingArtifacts = await runSelfHostCommand({
        subcommand: "check",
        workspaceRoot: project,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });
      expect(missingArtifacts.exitCode).toBe(1);

      await runSelfHostCommand({
        subcommand: "compose",
        workspaceRoot: project,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });

      const checked = await runSelfHostCommand({
        subcommand: "check",
        workspaceRoot: project,
        json: false,
        withWeb: true,
        postgresVersion: "16",
        runtimePort: 3765,
        webPort: 3000,
      });
      expect(checked.exitCode).toBe(0);
      expect(checked.checks?.map((check) => check.name)).toContain("generated");
      expect(checked.checks?.map((check) => check.name)).toContain("env-example-secrets");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("forge build writes a deploy build manifest for a minimal workspace", async () => {
    const workspace = tempWorkspace("h18-build");
    try {
      writeFileSync(
        join(workspace, "package.json"),
        JSON.stringify({ name: "h18-build", private: true, type: "module" }, null, 2),
        "utf8",
      );
      mkdirSync(join(workspace, "src", "forge"), { recursive: true });
      mkdirSync(join(workspace, "src", "commands"), { recursive: true });
      writeFileSync(
        join(workspace, "src", "forge", "schema.ts"),
        `
          import { defineTable } from "forge/server";
          export const tickets = defineTable("tickets", {
            id: "uuid",
            title: "text",
          });
        `,
        "utf8",
      );
      writeFileSync(
        join(workspace, "src", "policies.ts"),
        `
          import { canRole, definePolicies } from "forge/policy";
          export const policies = definePolicies({
            "tickets.create": canRole("owner", "admin"),
          });
        `,
        "utf8",
      );
      writeFileSync(
        join(workspace, "src", "commands", "createTicket.ts"),
        `
          import { can, command } from "forge/server";
          export const createTicket = command({
            auth: can("tickets.create"),
            handler: async (ctx, args) => ctx.db.tickets.insert({ title: args.title }),
          });
        `,
        "utf8",
      );

      const result = await runBuildCommand({
        workspaceRoot: workspace,
        json: false,
      });
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(workspace, "dist", "forge", "build-info.json"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
