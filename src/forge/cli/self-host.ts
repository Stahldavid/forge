import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { runGenerateCommand } from "./commands.ts";
import { runVerifyCommand } from "./verify.ts";
import { selfHostPrepareNextActions, selfHostReadyNextActions } from "./next-actions.ts";

export type SelfHostSubcommand = "compose" | "env" | "check" | "clean";

export interface SelfHostCommandOptions {
  subcommand: SelfHostSubcommand;
  workspaceRoot: string;
  json: boolean;
  withWeb: boolean;
  postgresVersion: string;
  runtimePort: number;
  webPort: number;
  preparedOnly?: boolean;
}

export interface SelfHostCheck {
  name: string;
  ok: boolean;
  details?: unknown;
}

export interface SelfHostCommandResult {
  ok: boolean;
  exitCode: 0 | 1;
  state?: "ready" | "not-prepared" | "failed";
  files?: string[];
  checks?: SelfHostCheck[];
  nextActions?: string[];
}

function deployDir(workspaceRoot: string): string {
  return join(workspaceRoot, "deploy");
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return JSON.parse(stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""))) as T;
}

function requiredEnvNames(workspaceRoot: string): string[] {
  const secretRegistry = readGeneratedJson<{ secrets?: Array<{ name: string }> }>(
    workspaceRoot,
    `${GENERATED_DIR}/secretRegistry.json`,
  );
  const envSchema = readGeneratedJson<{ variables?: Array<{ name: string }> }>(
    workspaceRoot,
    `${GENERATED_DIR}/envSchema.json`,
  );

  const names = new Set([
    "DATABASE_URL",
    "FORGE_ENV",
    "FORGE_PORT",
    "FORGE_RELEASE_ID",
    "FORGE_DEPLOY_ID",
    "FORGE_DEPLOY_ENV",
    "FORGE_LIVE_TRANSPORT",
    "FORGE_LIVE_INVALIDATION",
    "FORGE_LIVE_POLL_INTERVAL_MS",
    "FORGE_LIVE_HEARTBEAT_MS",
    "FORGE_AUTH_MODE",
    "FORGE_AUTH_ISSUER",
    "FORGE_AUTH_AUDIENCE",
    "FORGE_AUTH_JWKS_URI",
    "FORGE_AUTH_ALGORITHMS",
    "NEXT_PUBLIC_FORGE_URL",
    "NEXT_PUBLIC_FORGE_RELEASE_ID",
    "POSTHOG_KEY",
    "POSTHOG_HOST",
    "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "AI_GATEWAY_API_KEY",
  ]);

  for (const secret of secretRegistry?.secrets ?? []) {
    names.add(secret.name);
  }
  for (const variable of envSchema?.variables ?? []) {
    names.add(variable.name);
  }

  return [...names].sort();
}

function renderEnvExample(workspaceRoot: string): string {
  const values: Record<string, string> = {
    DATABASE_URL: "postgres://forge:forge@postgres:5432/forge_app",
    FORGE_ENV: "production",
    FORGE_PORT: "3765",
    FORGE_RELEASE_ID: "",
    FORGE_DEPLOY_ID: "",
    FORGE_DEPLOY_ENV: "production",
    FORGE_LIVE_TRANSPORT: "sse",
    FORGE_LIVE_INVALIDATION: "polling,postgres-notify",
    FORGE_LIVE_POLL_INTERVAL_MS: "1000",
    FORGE_LIVE_HEARTBEAT_MS: "15000",
    FORGE_AUTH_MODE: "oidc",
    FORGE_AUTH_ISSUER: "",
    FORGE_AUTH_AUDIENCE: "",
    FORGE_AUTH_JWKS_URI: "",
    FORGE_AUTH_ALGORITHMS: "RS256",
    NEXT_PUBLIC_FORGE_URL: "http://localhost:3765",
    NEXT_PUBLIC_FORGE_RELEASE_ID: "",
  };

  const lines = [
    "# Database",
    `DATABASE_URL=${values.DATABASE_URL}`,
    "",
    "# Forge runtime",
    `FORGE_ENV=${values.FORGE_ENV}`,
    `FORGE_PORT=${values.FORGE_PORT}`,
    `FORGE_RELEASE_ID=${values.FORGE_RELEASE_ID}`,
    `FORGE_DEPLOY_ID=${values.FORGE_DEPLOY_ID}`,
    `FORGE_DEPLOY_ENV=${values.FORGE_DEPLOY_ENV}`,
    "",
    "# LiveQuery production hardening",
    `FORGE_LIVE_TRANSPORT=${values.FORGE_LIVE_TRANSPORT}`,
    `FORGE_LIVE_INVALIDATION=${values.FORGE_LIVE_INVALIDATION}`,
    `FORGE_LIVE_POLL_INTERVAL_MS=${values.FORGE_LIVE_POLL_INTERVAL_MS}`,
    `FORGE_LIVE_HEARTBEAT_MS=${values.FORGE_LIVE_HEARTBEAT_MS}`,
    "",
    "# Auth",
    `FORGE_AUTH_MODE=${values.FORGE_AUTH_MODE}`,
    `FORGE_AUTH_ISSUER=${values.FORGE_AUTH_ISSUER}`,
    `FORGE_AUTH_AUDIENCE=${values.FORGE_AUTH_AUDIENCE}`,
    `FORGE_AUTH_JWKS_URI=${values.FORGE_AUTH_JWKS_URI}`,
    `FORGE_AUTH_ALGORITHMS=${values.FORGE_AUTH_ALGORITHMS}`,
    "",
    "# Frontend",
    `NEXT_PUBLIC_FORGE_URL=${values.NEXT_PUBLIC_FORGE_URL}`,
    `NEXT_PUBLIC_FORGE_RELEASE_ID=${values.NEXT_PUBLIC_FORGE_RELEASE_ID}`,
    "",
    "# Secrets and integrations",
  ];

  for (const name of requiredEnvNames(workspaceRoot)) {
    if (name in values) {
      continue;
    }
    lines.push(`${name}=`);
  }

  return `${lines.join("\n")}\n`;
}

function renderCompose(options: SelfHostCommandOptions): string {
  const web = options.withWeb
    ? `
  web:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.web
    environment:
      NEXT_PUBLIC_FORGE_URL: http://localhost:${options.runtimePort}
      PORT: ${options.webPort}
      HOSTNAME: 0.0.0.0
    depends_on:
      - forge-runtime
    ports:
      - "${options.webPort}:${options.webPort}"
`
    : "";

  return `services:
  postgres:
    image: postgres:${options.postgresVersion}
    environment:
      POSTGRES_USER: forge
      POSTGRES_PASSWORD: forge
      POSTGRES_DB: forge_app
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forge -d forge_app"]
      interval: 5s
      timeout: 5s
      retries: 10

  forge-migrate:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["bun", "run", "forge", "db", "migrate", "--db", "postgres"]
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://forge:forge@postgres:5432/forge_app
    depends_on:
      postgres:
        condition: service_healthy

  forge-runtime:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["bun", "run", "forge", "serve", "--host", "0.0.0.0", "--port", "${options.runtimePort}"]
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://forge:forge@postgres:5432/forge_app
      FORGE_ENV: production
      FORGE_DEPLOY_ENV: production
      FORGE_LIVE_TRANSPORT: sse
      FORGE_LIVE_INVALIDATION: polling,postgres-notify
      FORGE_LIVE_POLL_INTERVAL_MS: 1000
      FORGE_LIVE_HEARTBEAT_MS: 15000
    depends_on:
      postgres:
        condition: service_healthy
      forge-migrate:
        condition: service_completed_successfully
    ports:
      - "${options.runtimePort}:${options.runtimePort}"

  forge-worker:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ["bun", "run", "forge", "worker", "--db", "postgres"]
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://forge:forge@postgres:5432/forge_app
      FORGE_ENV: production
      FORGE_DEPLOY_ENV: production
      FORGE_LIVE_INVALIDATION: polling,postgres-notify
    depends_on:
      postgres:
        condition: service_healthy
      forge-migrate:
        condition: service_completed_successfully
${web}
volumes:
  postgres_data:
`;
}

function renderRuntimeDockerfile(): string {
  return `FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run forge generate
RUN bun run forge verify --strict

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app ./
USER bun
EXPOSE 3765
CMD ["bun", "run", "forge", "serve", "--host", "0.0.0.0", "--port", "3765"]
`;
}

function renderWebDockerfile(): string {
  return `FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
COPY web/package.json web/package.json
RUN bun install --frozen-lockfile

FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
WORKDIR /app/web
RUN bun run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./.next/static
COPY --from=build /app/web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
`;
}

function renderDockerignore(): string {
  return `node_modules
web/node_modules

.git
.gitignore

.env
.env.*
!.env.example

.forge/local
.forge/cache

coverage
test-results*.txt
tsc-output*.txt
test-run-output*.txt

Dockerfile*
docker-compose*
deploy/*.local.*
`;
}

function renderReadme(): string {
  return `# ForgeOS Self-host Deploy

## Quick Start

\`\`\`bash
forge self-host compose
cp deploy/.env.example deploy/.env
docker compose -f deploy/docker-compose.yml up --build
\`\`\`

Services:
- postgres
- forge-migrate
- forge-runtime
- forge-worker
- web

Notes:
- The runtime does not apply migrations on boot; \`forge-migrate\` does that explicitly.
- H20 expects \`FORGE_AUTH_MODE=jwt\` or \`oidc\` for production. Use access tokens with the Forge API audience.
- LiveQuery uses a durable invalidation table plus polling and optional Postgres notify wakeups. Sticky sessions are recommended for smoother SSE reconnects, but any runtime can recover from the durable log.
`;
}

function renderDeployManifest(options: SelfHostCommandOptions): string {
  return `${JSON.stringify({
    schemaVersion: "0.1.0",
    services: {
      runtime: { command: "forge serve", port: options.runtimePort },
      worker: { command: "forge worker" },
      web: options.withWeb ? { framework: "next", port: options.webPort } : null,
    },
    database: { kind: "postgres", env: "DATABASE_URL" },
  }, null, 2)}\n`;
}

export async function runSelfHostCommand(
  options: SelfHostCommandOptions,
): Promise<SelfHostCommandResult> {
  const dir = deployDir(options.workspaceRoot);

  if (options.subcommand === "clean") {
    nodeFileSystem.remove(dir);
    return { ok: true, exitCode: 0, files: [] };
  }

  if (options.subcommand === "compose" || options.subcommand === "env") {
    nodeFileSystem.mkdirp(dir);
    const files: Array<[string, string]> = [];
    if (options.subcommand === "compose") {
      files.push(
        ["docker-compose.yml", renderCompose(options)],
        ["Dockerfile.runtime", renderRuntimeDockerfile()],
        ["Dockerfile.web", renderWebDockerfile()],
        [".dockerignore", renderDockerignore()],
        ["README.md", renderReadme()],
        ["deployManifest.json", renderDeployManifest(options)],
      );
    }
    files.push([".env.example", renderEnvExample(options.workspaceRoot)]);
    for (const [file, contents] of files) {
      nodeFileSystem.writeText(join(dir, file), contents);
    }
    return { ok: true, exitCode: 0, files: files.map(([file]) => `deploy/${file}`) };
  }

  const checks: SelfHostCheck[] = [];
  const requiredDeployFiles = [
    "docker-compose.yml",
    "Dockerfile.runtime",
    "Dockerfile.web",
    ".dockerignore",
    ".env.example",
    "README.md",
  ];
  const missingDeployFiles = requiredDeployFiles.filter((file) => !nodeFileSystem.exists(join(dir, file)));
  if (options.preparedOnly && missingDeployFiles.length > 0) {
    return {
      ok: true,
      state: "not-prepared",
      exitCode: 0,
      checks: missingDeployFiles.map((file) => ({
        name: `deploy/${file}`,
        ok: true,
        details: { state: "not-prepared", missing: true, command: "forge self-host compose" },
      })),
      nextActions: selfHostPrepareNextActions(),
    };
  }
  const generated = await runGenerateCommand({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  checks.push({
    name: "generated",
    ok: generated.exitCode === 0,
    details: generated.exitCode === 0 ? undefined : { command: "forge generate" },
  });

  const verify = await runVerifyCommand({
    workspaceRoot: options.workspaceRoot,
    json: false,
    skipTests: true,
    skipTypecheck: true,
    skipEslint: true,
    strict: true,
  });
  checks.push({
    name: "verify-strict",
    ok: verify.exitCode === 0,
    details: verify.exitCode === 0 ? undefined : { command: "forge verify --strict" },
  });

  for (const file of requiredDeployFiles) {
    const exists = nodeFileSystem.exists(join(dir, file));
    checks.push({
      name: `deploy/${file}`,
      ok: exists,
      details: exists ? undefined : { missing: true, command: "forge self-host compose" },
    });
  }

  const envExample = nodeFileSystem.exists(join(dir, ".env.example"))
    ? (nodeFileSystem.readText(join(dir, ".env.example")) ?? "")
    : "";
  const missingEnv = requiredEnvNames(options.workspaceRoot).filter(
    (name) => !envExample.includes(`${name}=`),
  );
  checks.push({
    name: "env-example-secrets",
    ok: missingEnv.length === 0,
    details: missingEnv.length > 0 ? { missing: missingEnv } : undefined,
  });
  const authEnvNames = [
    "FORGE_AUTH_MODE",
    "FORGE_AUTH_ISSUER",
    "FORGE_AUTH_AUDIENCE",
    "FORGE_AUTH_JWKS_URI",
    "FORGE_AUTH_ALGORITHMS",
  ];
  checks.push({
    name: "auth-config",
    ok: authEnvNames.every((name) => envExample.includes(`${name}=`)) &&
      !envExample.includes("FORGE_AUTH_MODE=dev-headers"),
  });
  checks.push({
    name: "dockerignore-excludes-env",
    ok: nodeFileSystem.exists(join(dir, ".dockerignore")) &&
      (nodeFileSystem.readText(join(dir, ".dockerignore")) ?? "").includes(".env"),
  });

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    state: ok ? "ready" : "failed",
    exitCode: ok ? 0 : 1,
    checks,
    nextActions: ok ? selfHostReadyNextActions() : selfHostPrepareNextActions(),
  };
}

export function formatSelfHostHuman(result: SelfHostCommandResult): string {
  if (result.files) {
    return `wrote self-host files:\n${result.files.map((file) => `  ${file}`).join("\n")}\n`;
  }
  if (result.checks) {
    const lines = result.checks
      .map((check) => `${check.ok ? "ok" : "fail"} ${check.name}`)
      .join("\n");
    const next = result.nextActions && result.nextActions.length > 0
      ? `\nNext:\n${result.nextActions.map((action) => `  ${action}`).join("\n")}\n`
      : "\n";
    return `${lines}${next}`;
  }
  return result.ok ? "self-host clean complete\n" : "self-host command failed\n";
}
