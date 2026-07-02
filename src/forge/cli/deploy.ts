import { nodeFileSystem } from "../compiler/fs/index.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { detectPackageManager, getLockfileCandidates } from "../compiler/package-manager/detect.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import type { PackageManager } from "../compiler/types/runtime.ts";
import { loadAuthConfigFromEnv } from "../runtime/auth/config.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";
import { join } from "node:path";
import { runAuthCommand } from "./auth.ts";
import { runAuthMdCommand } from "./authmd.ts";
import { runWorkOSCommand } from "./workos.ts";

export type DeploySubcommand = "plan" | "check" | "render" | "package" | "verify";
export type DeployTarget = "docker" | "forge-cloud";

export interface DeployCommandOptions {
  subcommand: DeploySubcommand;
  workspaceRoot: string;
  json: boolean;
  target: DeployTarget;
  production: boolean;
  url?: string;
}

export interface DeployCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message: string;
  command?: string;
  details?: unknown;
}

export interface DeployCommandResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  kind: "deploy";
  action: DeploySubcommand;
  target: DeployTarget;
  production: boolean;
  checks: DeployCheck[];
  files?: string[];
  plan?: {
    summary: string;
    commands: string[];
    gates: string[];
    notes: string[];
  };
  probes?: Array<{ method: string; url: string; ok: boolean; status?: number; contentType?: string; error?: string; jsonValid?: boolean }>;
  nextActions: string[];
  exitCode: 0 | 1;
}

interface DeployProbeExpectation {
  contentTypeIncludes?: string;
  json?: boolean;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) return null;
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "")) as T;
  } catch {
    return null;
  }
}

function packageJson(workspaceRoot: string): Record<string, unknown> {
  try {
    return JSON.parse(nodeFileSystem.readText(join(workspaceRoot, "package.json")) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasScript(workspaceRoot: string, name: string): boolean {
  const scripts = packageJson(workspaceRoot).scripts;
  return Boolean(scripts && typeof scripts === "object" && name in scripts);
}

function requiredSecretNames(workspaceRoot: string): string[] {
  return (loadSecretRegistry(workspaceRoot)?.secrets ?? [])
    .map((secret) => secret.name)
    .filter(Boolean)
    .sort();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function hasWorkOSIntegration(workspaceRoot: string): boolean {
  const secrets = new Set(requiredSecretNames(workspaceRoot));
  return secrets.has("WORKOS_API_KEY") ||
    secrets.has("WORKOS_CLIENT_ID") ||
    nodeFileSystem.exists(join(workspaceRoot, `${GENERATED_DIR}/integrations/workos`)) ||
    nodeFileSystem.exists(join(workspaceRoot, "src/policies.workos.ts"));
}

function readJsonFile<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) return null;
  try {
    return JSON.parse(nodeFileSystem.readText(absolute) ?? "null") as T;
  } catch {
    return null;
  }
}

function fieldTestReportCandidates(workspaceRoot: string): Array<{ path: string; data: Record<string, unknown> }> {
  const paths = [".forge/field-test-report.json", "field-reports/full-alpha.json"];
  return paths.flatMap((path) => {
    const data = readJsonFile<Record<string, unknown>>(workspaceRoot, path);
    return data ? [{ path, data }] : [];
  });
}

const FIELD_TEST_PRODUCTION_COMMAND = "forge field-test run --realistic --json";
const DEPLOY_ENV_FILE = "deploy/.env.production";
const LOCAL_ENV_FILES = [".env", ".env.local"];
const DEPLOY_ENV_KEYS = [
  "DATABASE_URL",
  "FORGE_AUTH_MODE",
  "FORGE_AUTH_ISSUER",
  "FORGE_AUTH_AUDIENCE",
  "FORGE_AUTH_JWKS_URI",
  "FORGE_AUTH_DISCOVERY_URL",
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
  "WORKOS_POST_LOGIN_REDIRECT_URI",
  "WORKOS_POST_LOGOUT_REDIRECT_URI",
  "WORKOS_WEBHOOK_SECRET",
];

function summarizeFieldTestReport(data: Record<string, unknown>) {
  const results = Array.isArray(data.results) ? data.results as Array<Record<string, unknown>> : [];
  const failed = results.filter((result) => result.ok === false && result.skipped !== true);
  const skipped = results.filter((result) => result.skipped === true);
  const executed = results.filter((result) => result.skipped !== true);
  const topLevelSteps = results.flatMap((result) =>
    Array.isArray(result.steps) ? result.steps as Array<Record<string, unknown>> : [],
  );
  const runtimeSteps = results.flatMap((result) => {
    const runtime = result.runtime && typeof result.runtime === "object"
      ? result.runtime as Record<string, unknown>
      : {};
    return Array.isArray(runtime.steps) ? runtime.steps as Array<Record<string, unknown>> : [];
  });
  const commandOf = (step: unknown): string =>
    step && typeof step === "object" && typeof (step as { command?: unknown }).command === "string"
      ? (step as { command: string }).command
      : "";
  const okStep = (step: unknown): boolean =>
    Boolean(step && typeof step === "object" && (step as { ok?: unknown }).ok === true);
  const hasOkRuntimeCommand = (pattern: RegExp): boolean =>
    runtimeSteps.some((step) => okStep(step) && pattern.test(commandOf(step)));
  const hasOkTopLevelCommand = (pattern: RegExp): boolean =>
    topLevelSteps.some((step) => okStep(step) && pattern.test(commandOf(step)));
  const authSetupProbeSteps = topLevelSteps.filter((step) =>
    /forge\s+(?:--\s+)?(add\s+auth\s+workos|authmd\s+generate|authmd\s+check|workos\s+doctor|workos\s+seed|workos\s+prove|auth\s+prove)/.test(commandOf(step)),
  );
  const authMetadataProbeSteps = runtimeSteps.filter((step) =>
    /^(HEAD|GET)\s+https?:\/\/[^/]+\/(auth\.md|\.well-known\/oauth-protected-resource)\b/i.test(commandOf(step)),
  );
  const uiErgonomicsResults = results
    .map((result) => result.uiErgonomics)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
  const uiErgonomicsWarnings = uiErgonomicsResults.reduce((total, result) =>
    total + (typeof result.warnings === "number" ? result.warnings : 0), 0);
  const uiErgonomicsErrors = uiErgonomicsResults.reduce((total, result) =>
    total + (typeof result.errors === "number" ? result.errors : 0), 0);
  const runtimeProbes = data.runtimeProbes === true;
  const authProbes = data.authProbes === true;
  const uiProbes = data.uiProbes === true;
  const uiProbeSteps = runtimeSteps.filter((step) =>
    /^GET\s+https?:\/\/[^/]+\/$/i.test(commandOf(step)),
  );
  const uiErgonomics = uiProbes !== true || (executed.length > 0 && uiErgonomicsResults.length === executed.length);
  const runtimeHealthEvidence = !runtimeProbes || hasOkRuntimeCommand(/\bGET\s+.*\/health\b/i);
  const runtimeEntriesEvidence = !runtimeProbes || hasOkRuntimeCommand(/\bGET\s+.*\/entries\b/i);
  const authSetupEvidence = !authProbes || [
    /forge\s+(?:--\s+)?add\s+auth\s+workos\b/,
    /forge\s+(?:--\s+)?authmd\s+generate\b/,
    /forge\s+(?:--\s+)?authmd\s+check\b/,
    /forge\s+(?:--\s+)?workos\s+doctor\b/,
    /forge\s+(?:--\s+)?workos\s+seed\b/,
    /forge\s+(?:--\s+)?workos\s+prove\b/,
    /forge\s+(?:--\s+)?auth\s+prove\b/,
  ].every((pattern) => hasOkTopLevelCommand(pattern));
  const authMetadataEvidence = !authProbes || [
    /^HEAD\s+.*\/auth\.md\b/i,
    /^GET\s+.*\/auth\.md\b/i,
    /^HEAD\s+.*\/\.well-known\/oauth-protected-resource\b/i,
    /^GET\s+.*\/\.well-known\/oauth-protected-resource\b/i,
  ].every((pattern) => hasOkRuntimeCommand(pattern));
  const uiProbeEvidence = !uiProbes || uiProbeSteps.some((step) => okStep(step));
  const productionEvidenceMissing = [
    ...(data.ok !== true ? ["passing field-test report"] : []),
    ...(!runtimeProbes ? ["runtime probes"] : []),
    ...(!authProbes ? ["auth probes"] : []),
    ...(!uiProbes ? ["ui probes"] : []),
    ...(!runtimeHealthEvidence ? ["runtime health probe"] : []),
    ...(!runtimeEntriesEvidence ? ["runtime entries probe"] : []),
    ...(!authSetupEvidence ? ["auth setup probes"] : []),
    ...(!authMetadataEvidence ? ["auth metadata endpoint probes"] : []),
    ...(!uiProbeEvidence ? ["web UI probe"] : []),
    ...(!uiErgonomics ? ["UI ergonomics audit"] : []),
    ...(uiErgonomicsErrors > 0 ? ["zero UI ergonomics errors"] : []),
    ...(failed.length > 0 ? ["zero failed cases"] : []),
  ];
  return {
    ok: data.ok === true,
    cases: results.length,
    passed: results.filter((result) => result.ok === true && result.skipped !== true).length,
    failed: failed.length,
    skipped: skipped.length,
    runtimeProbes,
    authProbes,
    uiProbes,
    uiErgonomics,
    uiErgonomicsWarnings,
    uiErgonomicsErrors,
    runtimeProbeSteps: runtimeSteps.length,
    authSetupProbeSteps: authSetupProbeSteps.length,
    authMetadataProbeSteps: authMetadataProbeSteps.length,
    uiProbeSteps: uiProbeSteps.length,
    productionEvidence: {
      readyForDeployCheck: productionEvidenceMissing.length === 0,
      missing: productionEvidenceMissing,
    },
  };
}

function shellCommand(command: string): string {
  return `["sh", "-lc", ${JSON.stringify(command)}]`;
}

function runPackageScript(packageManager: PackageManager, script: string): string {
  switch (packageManager) {
    case "npm":
      return `npm run ${script}`;
    case "pnpm":
      return `pnpm run ${script}`;
    case "yarn":
      return `yarn run ${script}`;
    case "bun":
      return `bun run ${script}`;
  }
}

function runForgeScript(packageManager: PackageManager, args: string): string {
  switch (packageManager) {
    case "npm":
      return `npm run forge -- ${args}`;
    case "pnpm":
      return `pnpm run forge -- ${args}`;
    case "yarn":
      return `yarn run forge ${args}`;
    case "bun":
      return `bun run forge -- ${args}`;
  }
}

function packageManagerSpec(workspaceRoot: string, packageManager: PackageManager): string {
  try {
    const pkg = JSON.parse(nodeFileSystem.readText(join(workspaceRoot, "package.json")) ?? "{}") as { packageManager?: string };
    if (pkg.packageManager?.startsWith(`${packageManager}@`)) return pkg.packageManager;
  } catch {
    // fall through to package manager name
  }
  return packageManager;
}

function dockerPackageCopyLine(workspaceRoot: string, packageManager: PackageManager): string {
  const files = [
    "package.json",
    ...activeLockfiles(workspaceRoot, packageManager),
  ];
  return `COPY ${files.join(" ")} ./`;
}

function activeLockfiles(workspaceRoot: string, packageManager = detectPackageManager(workspaceRoot)): string[] {
  return getLockfileCandidates(packageManager).filter((file) => nodeFileSystem.exists(join(workspaceRoot, file)));
}

function packageInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "npm":
      return "npm install";
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
  }
}

function dockerPackageSetup(workspaceRoot: string, packageManager: PackageManager): string[] {
  if (packageManager === "npm") return [];
  if (packageManager === "bun") {
    return [`RUN npm install -g ${packageManagerSpec(workspaceRoot, packageManager)}`];
  }
  return ["RUN corepack enable"];
}

function dockerInstallCommand(workspaceRoot: string, packageManager: PackageManager): string {
  const hasLockfile = activeLockfiles(workspaceRoot, packageManager).length > 0;
  switch (packageManager) {
    case "npm":
      return hasLockfile ? "RUN npm ci" : "RUN npm install";
    case "pnpm":
      return hasLockfile ? "RUN pnpm install --frozen-lockfile" : "RUN pnpm install";
    case "yarn":
      return hasLockfile ? "RUN yarn install --immutable || yarn install --frozen-lockfile" : "RUN yarn install";
    case "bun":
      return hasLockfile ? "RUN bun install --frozen-lockfile" : "RUN bun install";
  }
}

function dockerRunIfScriptPresent(packageManager: PackageManager, script: string): string {
  return `RUN if node -e "process.exit(require('./package.json').scripts?.[${JSON.stringify(script)}] ? 0 : 1)"; then ${runPackageScript(packageManager, script)}; fi`;
}

function renderDockerCompose(workspaceRoot: string): string {
  const packageManager = detectPackageManager(workspaceRoot);
  return `services:
  postgres:
    image: postgres:16
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
    command: ${shellCommand(runForgeScript(packageManager, "db migrate --db postgres"))}
    env_file:
      - .env.production
    depends_on:
      postgres:
        condition: service_healthy

  forge-runtime:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ${shellCommand(runForgeScript(packageManager, "serve --host 0.0.0.0 --port 3765"))}
    env_file:
      - .env.production
    environment:
      FORGE_ENV: production
      FORGE_DEPLOY_ENV: production
      FORGE_LIVE_TRANSPORT: sse
      FORGE_LIVE_INVALIDATION: polling,postgres-notify
    depends_on:
      postgres:
        condition: service_healthy
      forge-migrate:
        condition: service_completed_successfully
    ports:
      - "3765:3765"

  forge-worker:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.runtime
    command: ${shellCommand(runForgeScript(packageManager, "worker --db postgres"))}
    env_file:
      - .env.production
    environment:
      FORGE_ENV: production
      FORGE_DEPLOY_ENV: production
    depends_on:
      postgres:
        condition: service_healthy
      forge-migrate:
        condition: service_completed_successfully

volumes:
  postgres_data:
`;
}

function renderRuntimeDockerfile(workspaceRoot: string): string {
  const packageManager = detectPackageManager(workspaceRoot);
  return `FROM node:22-slim AS deps
WORKDIR /app
${dockerPackageCopyLine(workspaceRoot, packageManager)}
${[...dockerPackageSetup(workspaceRoot, packageManager), dockerInstallCommand(workspaceRoot, packageManager)].join("\n")}

FROM deps AS build
COPY . .
RUN ${runForgeScript(packageManager, "generate")}
${dockerRunIfScriptPresent(packageManager, "typecheck")}

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app ./
EXPOSE 3765
CMD ${shellCommand(runForgeScript(packageManager, "serve --host 0.0.0.0 --port 3765"))}
`;
}

function renderEnvExample(workspaceRoot: string): string {
  const secrets = requiredSecretNames(workspaceRoot);
  const base = [
    "DATABASE_URL=postgres://forge:forge@postgres:5432/forge_app",
    "FORGE_ENV=production",
    "FORGE_DEPLOY_ENV=production",
    "FORGE_PORT=3765",
    "FORGE_AUTH_MODE=oidc",
    "FORGE_AUTH_ISSUER=",
    "FORGE_AUTH_AUDIENCE=",
    "FORGE_AUTH_JWKS_URI=",
    "FORGE_AUTH_ALGORITHMS=RS256",
    "FORGE_LIVE_TRANSPORT=sse",
    "FORGE_LIVE_INVALIDATION=polling,postgres-notify",
    "FORGE_LIVE_POLL_INTERVAL_MS=1000",
    "FORGE_LIVE_HEARTBEAT_MS=15000",
    "FORGE_CORS_ORIGINS=https://app.example.com",
  ];
  const present = new Set(base.map((line) => line.split("=")[0]));
  for (const secret of secrets) {
    if (!present.has(secret)) base.push(`${secret}=`);
  }
  return `${base.join("\n")}\n`;
}

function hasProductionEnvFile(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, DEPLOY_ENV_FILE));
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFile(workspaceRoot: string, relative: string): Record<string, string> {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) return {};
  const text = nodeFileSystem.readText(absolute) ?? "";
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]!] = parseEnvValue(match[2] ?? "");
  }
  return values;
}

function readDeployEnvFile(workspaceRoot: string): Record<string, string> {
  return readEnvFile(workspaceRoot, DEPLOY_ENV_FILE);
}

function envKeys(values: Record<string, string>): string[] {
  return DEPLOY_ENV_KEYS.filter((key) => Boolean(values[key])).sort();
}

function processDeployEnv(): Record<string, string> {
  return Object.fromEntries(
    DEPLOY_ENV_KEYS
      .filter((key) => Boolean(process.env[key]))
      .map((key) => [key, process.env[key]!]),
  );
}

function deployEnvSources(workspaceRoot: string): Record<string, unknown> {
  const processEnv = processDeployEnv();
  const deployEnv = readDeployEnvFile(workspaceRoot);
  const localSources = LOCAL_ENV_FILES.map((path) => {
    const values = readEnvFile(workspaceRoot, path);
    return {
      path,
      present: nodeFileSystem.exists(join(workspaceRoot, path)),
      role: "local-guidance",
      readForProduction: false,
      keys: envKeys(values),
    };
  });
  const productionEvidence = {
    ...deployEnv,
    ...processEnv,
  };
  return {
    readOrder: ["process.env", DEPLOY_ENV_FILE],
    note: `${DEPLOY_ENV_FILE} and current process env are production deploy evidence; .env/.env.local are reported only as local guidance and are not used to pass production gates.`,
    sources: [
      {
        path: "process.env",
        present: envKeys(processEnv).length > 0,
        role: "production-evidence",
        readForProduction: true,
        keys: envKeys(processEnv),
      },
      {
        path: DEPLOY_ENV_FILE,
        present: hasProductionEnvFile(workspaceRoot),
        role: "production-evidence",
        readForProduction: true,
        keys: envKeys(deployEnv),
      },
      ...localSources,
    ],
    missingProductionKeys: DEPLOY_ENV_KEYS.filter((key) => !productionEvidence[key]),
  };
}

function deployEnvValue(workspaceRoot: string, name: string): string | undefined {
  return process.env[name] || readDeployEnvFile(workspaceRoot)[name];
}

async function withDeployEnv<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const deployEnv = readDeployEnvFile(workspaceRoot);
  const previous = new Map<string, string | undefined>();
  for (const [name, value] of Object.entries(deployEnv)) {
    if (process.env[name]) continue;
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

function hasRenderedProductionEnvExample(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, "deploy/.env.production.example"));
}

function databaseReady(options: DeployCommandOptions): boolean {
  if (deployEnvValue(options.workspaceRoot, "DATABASE_URL")) return true;
  if (!options.production) return hasRenderedProductionEnvExample(options.workspaceRoot);
  return false;
}

function databaseReadyMessage(options: DeployCommandOptions): string {
  if (process.env.DATABASE_URL) return "DATABASE_URL is set in the current environment";
  if (readDeployEnvFile(options.workspaceRoot).DATABASE_URL) return `DATABASE_URL is set in ${DEPLOY_ENV_FILE}`;
  if (hasProductionEnvFile(options.workspaceRoot)) return `${DEPLOY_ENV_FILE} is present but does not set DATABASE_URL`;
  if (hasRenderedProductionEnvExample(options.workspaceRoot)) {
    return options.production
      ? `deploy/.env.production.example is only a template; copy it to ${DEPLOY_ENV_FILE} with DATABASE_URL or set DATABASE_URL`
      : "deploy/.env.production.example is present";
  }
  return options.production
    ? `production deploy requires DATABASE_URL or ${DEPLOY_ENV_FILE}`
    : "deploy readiness requires DATABASE_URL or rendered deploy/.env.production.example";
}

function databaseReadyCommand(options: DeployCommandOptions): string {
  if (hasRenderedProductionEnvExample(options.workspaceRoot)) {
    return "cp deploy/.env.production.example deploy/.env.production";
  }
  return "forge deploy package --target docker";
}

function renderProductionReadme(): string {
  return `# ForgeOS Production Deploy

This directory is generated by \`forge deploy package --target docker\`.

## 1. Prepare production env

\`\`\`bash
cp deploy/.env.production.example deploy/.env.production
\`\`\`

Fill \`deploy/.env.production\` with real values before public traffic. \`forge deploy check --production\` reads this file as deploy evidence, so you do not need to export every value into the shell. Do not commit real secrets.

The generated Docker Compose stack also reads \`deploy/.env.production\` through \`env_file\`. It does not inject a hidden \`DATABASE_URL\` override into the Forge runtime, migrate, or worker services.

Required production posture:

- \`FORGE_AUTH_MODE=jwt\` or \`FORGE_AUTH_MODE=oidc\`
- \`DATABASE_URL\` points at a production Postgres database
- issuer, audience, and JWKS/discovery settings match the auth provider
- any provider secrets listed in the example are set in the deployment secret store

For WorkOS-backed apps, local dry-runs are not enough for production deploy
readiness. Run:

\`\`\`bash
forge workos prove --real --file workos-seed.yml --json
\`\`\`

This applies or confirms hosted WorkOS config/seed through the WorkOS CLI and
writes \`.workos-seed-state.json\`. \`forge deploy check --production\` requires
that state to match the current \`workos-seed.yml\` before treating WorkOS
posture as production evidence.

## 2. Prove the app before traffic

\`\`\`bash
forge generate --check --json
forge check --json
forge authmd generate --json
forge auth prove --scenario multi-tenant --json
forge workos prove --real --file workos-seed.yml --json
forge field-test run --realistic --json
forge deploy check --production --json
\`\`\`

\`forge deploy check --production\` requires real deploy env evidence. A template file alone is not enough.

## 3. Run Docker

\`\`\`bash
docker compose -f deploy/docker-compose.yml up --build
\`\`\`

## 4. Verify the public runtime

\`\`\`bash
forge auth prove --prod --token <jwt> --json
forge deploy verify --production --url https://app.example.com --json
\`\`\`

\`forge auth prove --prod\` verifies a real JWT/OIDC token against the configured issuer/audience/JWKS. \`forge deploy verify --production\` probes \`GET /health\`, \`HEAD /auth.md\`, \`GET /auth.md\`, \`HEAD /.well-known/oauth-protected-resource\`, and \`GET /.well-known/oauth-protected-resource\`; it also validates auth metadata content-types and requires the OAuth protected-resource metadata body to be valid JSON.
`;
}

function buildPlan(options: DeployCommandOptions): DeployCommandResult {
  const commands = options.target === "forge-cloud"
    ? [
        "forge deploy check --production --json",
        "forge auth check --production --json",
        "forge authmd check --json",
        FIELD_TEST_PRODUCTION_COMMAND,
        "forge field-test report --json",
        "forge deploy verify --production --url https://<your-forge-cloud-app> --json",
      ]
    : [
        "forge deploy package --target docker",
        "cp deploy/.env.production.example deploy/.env.production",
        "forge deploy check --production --json",
        FIELD_TEST_PRODUCTION_COMMAND,
        "docker compose -f deploy/docker-compose.yml up --build",
        "forge deploy verify --production --url https://app.example.com --json",
      ];
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: true,
    kind: "deploy",
    action: "plan",
    target: options.target,
    production: options.production,
    checks: [],
    plan: {
      summary: options.target === "forge-cloud"
        ? "Forge Cloud should be treated as a future managed target; current production proof still uses the same readiness gates."
        : "Docker production deploy uses Postgres, explicit migration, runtime, worker, production auth, and public metadata checks.",
      commands,
      gates: [
        "generated artifacts fresh",
        "forge check passes",
        "auth mode is jwt or oidc",
        "production database env evidence is present",
        "required secret names are present",
        "auth.md and protected-resource metadata are published",
        "field-test report exists with runtime/auth/UI probes",
        "runtime /health responds",
        "tenant and policy proof is run before public traffic",
      ],
      notes: [
        "dev-headers auth is local-only and must not be enabled for public runtime.",
        "Use forge workos doctor/seed when WorkOS is configured.",
        "Use forge test authz or HTTP probes to prove cross-tenant denial.",
      ],
    },
    nextActions: commands,
    exitCode: 0,
  });
}

async function buildChecks(options: DeployCommandOptions): Promise<DeployCommandResult> {
  const checks: DeployCheck[] = [];
  const generated = await runGenerate({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  checks.push({
    name: "generated",
    ok: generated.exitCode === 0,
    severity: "error",
    message: generated.exitCode === 0 ? "generated artifacts are fresh" : "generated artifacts are stale; run forge generate",
    command: "forge generate --check --json",
  });
  const packageManager = detectPackageManager(options.workspaceRoot);
  const lockfiles = activeLockfiles(options.workspaceRoot, packageManager);
  checks.push({
    name: "package-lockfile",
    ok: lockfiles.length > 0,
    severity: options.production ? "error" : "warning",
    message: lockfiles.length > 0
      ? `${packageManager} lockfile present: ${lockfiles.join(", ")}`
      : `no ${packageManager} lockfile found; production Docker builds should be reproducible`,
    command: packageInstallCommand(packageManager),
    details: {
      packageManager,
      expected: getLockfileCandidates(packageManager),
      found: lockfiles,
    },
  });
  checks.push({
    name: "deploy-env-sources",
    ok: true,
    severity: "warning",
    message: `${DEPLOY_ENV_FILE} and process.env are production deploy evidence; .env/.env.local are local guidance only`,
    details: deployEnvSources(options.workspaceRoot),
  });

  const auth = await withDeployEnv(options.workspaceRoot, async () => loadAuthConfigFromEnv(options.workspaceRoot));
  const productionAuth = auth.mode === "jwt" || auth.mode === "oidc";
  checks.push({
    name: "production-auth-mode",
    ok: productionAuth,
    severity: "error",
    message: productionAuth
      ? `auth mode ${auth.mode} is production-capable`
      : `auth mode ${auth.mode} is local-only; set FORGE_AUTH_MODE=jwt or oidc`,
    command: "forge auth check --production --json",
  });
  checks.push({
    name: "auth-issuer",
    ok: !productionAuth || Boolean(auth.issuer),
    severity: "error",
    message: !productionAuth || auth.issuer ? "issuer configured or not applicable" : "FORGE_AUTH_ISSUER is required",
  });
  checks.push({
    name: "auth-audience",
    ok: !productionAuth || Boolean(auth.audience),
    severity: "error",
    message: !productionAuth || auth.audience ? "audience configured or not applicable" : "FORGE_AUTH_AUDIENCE is required",
  });
  checks.push({
    name: "auth-jwks",
    ok: !productionAuth || auth.mode === "oidc" || Boolean(auth.jwksUri),
    severity: "error",
    message: !productionAuth || auth.mode === "oidc" || auth.jwksUri ? "JWKS/discovery configured or not applicable" : "FORGE_AUTH_JWKS_URI is required for jwt mode",
  });

  checks.push({
    name: "database-url",
    ok: databaseReady(options),
    severity: "error",
    message: databaseReadyMessage(options),
    command: databaseReadyCommand(options),
  });
  checks.push({
    name: "auth-md",
    ok: nodeFileSystem.exists(join(options.workspaceRoot, "public/auth.md")),
    severity: options.production ? "error" : "warning",
    message: options.production
      ? "public/auth.md must be published before production traffic so agents can discover the protected resource contract"
      : "public/auth.md should be published for agent-ready apps",
    command: "forge authmd generate --json",
  });
  checks.push({
    name: "oauth-protected-resource",
    ok: nodeFileSystem.exists(join(options.workspaceRoot, "public/.well-known/oauth-protected-resource")),
    severity: options.production ? "error" : "warning",
    message: options.production
      ? "OAuth protected-resource metadata must be published before production traffic"
      : "protected-resource metadata should be published for agent-ready apps",
    command: "forge authmd generate --json",
  });
  const authMdCheck = runAuthMdCommand({
    subcommand: "check",
    workspaceRoot: options.workspaceRoot,
    json: true,
  });
  checks.push({
    name: "auth-md-check",
    ok: authMdCheck.exitCode === 0,
    severity: options.production ? "error" : "warning",
    message: authMdCheck.exitCode === 0
      ? "auth.md and protected-resource metadata match the generated app contract"
      : (authMdCheck.diagnostics[0]?.message ?? "auth.md is missing or stale"),
    command: "forge authmd generate --json",
    details: {
      path: authMdCheck.path,
      metadataPath: authMdCheck.metadataPath,
      changed: authMdCheck.changed,
      diagnostics: authMdCheck.diagnostics,
    },
  });
  if (hasWorkOSIntegration(options.workspaceRoot)) {
    const workosDoctor = await withDeployEnv(options.workspaceRoot, async () =>
      runWorkOSCommand({
        subcommand: "doctor",
        workspaceRoot: options.workspaceRoot,
        json: true,
        yes: false,
        dryRun: true,
      })
    );
    checks.push({
      name: "workos-doctor",
      ok: workosDoctor.exitCode === 0,
      severity: options.production ? "error" : "warning",
      message: workosDoctor.exitCode === 0
        ? "WorkOS adapter files, seed, claims, policies, and FGA bridge are app-aware"
        : "WorkOS adapter is incomplete for this app; run forge workos doctor --json",
      command: "forge workos doctor --json",
      details: workosDoctor.checks,
    });
    const workosData = workosDoctor.data && typeof workosDoctor.data === "object"
      ? workosDoctor.data as { seedState?: { exists?: boolean; valid?: boolean; matchesSeedHash?: boolean | null; alreadyApplied?: boolean } }
      : {};
    const seedState = workosData.seedState;
    const hostedSeedOk = Boolean(seedState?.exists && seedState.valid && seedState.matchesSeedHash === true);
    checks.push({
      name: "workos-hosted-seed",
      ok: !options.production || hostedSeedOk,
      severity: options.production ? "error" : "warning",
      message: hostedSeedOk
        ? `WorkOS hosted seed state matches workos-seed.yml${seedState?.alreadyApplied ? " and records idempotent existing resources" : ""}`
        : "WorkOS production deploy requires hosted seed evidence matching workos-seed.yml",
      command: "forge workos prove --real --file workos-seed.yml --json",
      details: seedState,
    });
    const workosFgaDoctor = await withDeployEnv(options.workspaceRoot, async () =>
      runWorkOSCommand({
        subcommand: "fga",
        fgaAction: "doctor",
        workspaceRoot: options.workspaceRoot,
        json: true,
        yes: false,
        dryRun: true,
        real: options.production,
      })
    );
    checks.push({
      name: "workos-fga-proof",
      ok: !options.production || workosFgaDoctor.exitCode === 0,
      severity: options.production ? "error" : "warning",
      message: workosFgaDoctor.exitCode === 0
        ? "WorkOS FGA resource graph state matches the current app contract and seed"
        : "WorkOS production deploy requires FGA graph sync/proof evidence matching the current app",
      command: "forge workos fga prove --real --file workos-seed.yml --json",
      details: workosFgaDoctor.data,
    });
  }
  const tenantProofRequired = auth.requiresTenant || hasWorkOSIntegration(options.workspaceRoot);
  const tenantProof = tenantProofRequired
    ? await withDeployEnv(options.workspaceRoot, () =>
        runAuthCommand({
          subcommand: "prove",
          workspaceRoot: options.workspaceRoot,
          json: true,
          prod: false,
          scenario: "multi-tenant",
        })
      )
    : null;
  checks.push({
    name: "auth-tenant-proof",
    ok: tenantProofRequired ? tenantProof?.exitCode === 0 : true,
    severity: tenantProofRequired && options.production ? "error" : "warning",
    message: tenantProofRequired
      ? tenantProof?.exitCode === 0
        ? "local multi-tenant auth proof passed"
        : "local multi-tenant auth proof failed; prove claim mapping, seed coverage, permissions, and auth metadata before production"
      : "not required; app is not tenant-scoped and no WorkOS adapter was detected",
    command: tenantProofRequired ? "forge auth prove --scenario multi-tenant --json" : undefined,
    details: tenantProof?.data,
  });
  const fieldReports = fieldTestReportCandidates(options.workspaceRoot);
  const latestFieldReport = fieldReports[0];
  const fieldSummary = latestFieldReport ? summarizeFieldTestReport(latestFieldReport.data) : null;
  const fieldReportComplete = Boolean(fieldSummary?.productionEvidence.readyForDeployCheck);
  const fieldReportMissing = fieldSummary?.productionEvidence.missing ?? [];
  checks.push({
    name: "field-test-report",
    ok: fieldReportComplete,
    severity: options.production ? "error" : "warning",
    message: fieldSummary?.ok
      ? fieldReportComplete
        ? `field-test report ${latestFieldReport?.path} passed with concrete runtime, auth, metadata, UI, and ergonomics evidence`
        : `field-test report ${latestFieldReport?.path} passed but is missing deploy evidence: ${fieldReportMissing.join(", ")}`
      : latestFieldReport
        ? `field-test report ${latestFieldReport.path} did not pass`
      : `no field-test report found; run ${FIELD_TEST_PRODUCTION_COMMAND}`,
    command: FIELD_TEST_PRODUCTION_COMMAND,
    details: latestFieldReport ? { path: latestFieldReport.path, summary: fieldSummary } : undefined,
  });
  if (fieldSummary?.uiErgonomicsWarnings) {
    checks.push({
      name: "field-test-ui-ergonomics",
      ok: false,
      severity: "warning",
      message: `field-test UI ergonomics audit reported ${fieldSummary.uiErgonomicsWarnings} warning(s); fix the product surface before treating the app as polished`,
      command: "forge inspect ui --ergonomics --json",
      details: { path: latestFieldReport?.path, summary: fieldSummary },
    });
  }
  checks.push({
    name: "frontend-build-script",
    ok: !readGeneratedJson<FrontendGraph>(options.workspaceRoot, `${GENERATED_DIR}/frontendGraph.json`)?.present || hasScript(options.workspaceRoot, "build") || hasScript(join(options.workspaceRoot, "web"), "build"),
    severity: "warning",
    message: "frontend apps should expose a production build script",
  });
  checks.push({
    name: "tenant-claim",
    ok: !auth.requiresTenant || Boolean(auth.claims.tenantId),
    severity: "error",
    message: !auth.requiresTenant || auth.claims.tenantId ? "tenant claim mapping is present or not required" : "tenant-scoped production apps require a tenant claim mapping",
  });
  checks.push({
    name: "live-production",
    ok: true,
    severity: "warning",
    message: "production liveQuery must use durable invalidations; verify with forge inspect live-production --json",
    command: "forge inspect live-production --json",
  });

  const errorFree = checks.every((check) => check.ok || check.severity === "warning");
  const failureActions = unique(checks.flatMap((check) =>
    !check.ok && check.command ? expandDeployFailureCommand(check.command) : []
  ));
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: errorFree,
    kind: "deploy",
    action: "check",
    target: options.target,
    production: options.production,
    checks,
    nextActions: errorFree
      ? ["forge deploy verify --production --url https://app.example.com --json"]
      : failureActions,
    exitCode: errorFree ? 0 : 1,
  });
}

function expandDeployFailureCommand(command: string): string[] {
  if (command.includes("forge workos fga prove")) {
    return [
      "forge workos fga plan --file workos-seed.yml --write --json",
      "forge workos fga sync --real --file workos-seed.yml --json",
      command,
    ];
  }
  return [command];
}

function renderDocker(options: DeployCommandOptions): DeployCommandResult {
  const dir = join(options.workspaceRoot, "deploy");
  nodeFileSystem.mkdirp(dir);
  const files = [
    ["deploy/docker-compose.yml", renderDockerCompose(options.workspaceRoot)],
    ["deploy/Dockerfile.runtime", renderRuntimeDockerfile(options.workspaceRoot)],
    ["deploy/.env.production.example", renderEnvExample(options.workspaceRoot)],
    ["deploy/README.production.md", renderProductionReadme()],
  ] as const;
  for (const [file, content] of files) {
    nodeFileSystem.writeText(join(options.workspaceRoot, file), content);
  }
  return normalizeForgeCliCommandsInValue(options.workspaceRoot, {
    schemaVersion: "0.1.0",
    ok: true,
    kind: "deploy",
    action: options.subcommand,
    target: options.target,
    production: options.production,
    checks: [],
    files: files.map(([file]) => file),
    nextActions: [
      "cp deploy/.env.production.example deploy/.env.production",
      "forge deploy check --production --json",
      "docker compose -f deploy/docker-compose.yml up --build",
    ],
    exitCode: 0,
  });
}

async function probe(
  method: "GET" | "HEAD",
  url: string,
  expectation: DeployProbeExpectation = {},
): Promise<{ method: string; url: string; ok: boolean; status?: number; contentType?: string; error?: string; jsonValid?: boolean }> {
  try {
    const response = await fetch(url, { method });
    const contentType = response.headers.get("content-type") ?? undefined;
    const contentTypeOk = !expectation.contentTypeIncludes || contentType?.includes(expectation.contentTypeIncludes) === true;
    let jsonValid: boolean | undefined;
    let bodyError: string | undefined;
    if (expectation.json && method !== "HEAD") {
      const text = await response.text();
      try {
        JSON.parse(text);
        jsonValid = true;
      } catch (error) {
        jsonValid = false;
        bodyError = error instanceof Error ? error.message : String(error);
      }
    }
    const ok = response.ok && contentTypeOk && (jsonValid !== false);
    return {
      method,
      url,
      ok,
      status: response.status,
      contentType,
      ...(jsonValid !== undefined ? { jsonValid } : {}),
      ...(!contentTypeOk
        ? { error: `expected content-type including ${expectation.contentTypeIncludes}; received ${contentType ?? "none"}` }
        : bodyError
          ? { error: `invalid JSON: ${bodyError}` }
          : {}),
    };
  } catch (error) {
    return {
      method,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function verifyUrl(options: DeployCommandOptions): Promise<DeployCommandResult> {
  const base = options.url?.replace(/\/$/, "");
  if (!base) {
    return {
      schemaVersion: "0.1.0",
      ok: false,
      kind: "deploy",
      action: "verify",
      target: options.target,
      production: options.production,
      checks: [{ name: "url", ok: false, severity: "error", message: "--url is required" }],
      nextActions: ["forge deploy verify --url https://app.example.com --json"],
      exitCode: 1,
    };
  }
  const probes = await Promise.all([
    probe("GET", `${base}/health`),
    probe("HEAD", `${base}/auth.md`, { contentTypeIncludes: "text/markdown" }),
    probe("GET", `${base}/auth.md`, { contentTypeIncludes: "text/markdown" }),
    probe("HEAD", `${base}/.well-known/oauth-protected-resource`, { contentTypeIncludes: "application/json" }),
    probe("GET", `${base}/.well-known/oauth-protected-resource`, { contentTypeIncludes: "application/json", json: true }),
  ]);
  const checks = probes.map((item): DeployCheck => ({
    name: `${item.method} ${item.url.replace(base, "") || "/"}`,
    ok: item.ok,
    severity: item.url.endsWith("/health") || options.production ? "error" : "warning",
    message: item.ok
      ? `HTTP ${item.status}${item.contentType ? ` ${item.contentType}` : ""}`
      : item.error ?? `HTTP ${item.status ?? "failed"}`,
  }));
  const ok = checks.every((check) => check.ok || check.severity === "warning");
  return {
    schemaVersion: "0.1.0",
    ok,
    kind: "deploy",
    action: "verify",
    target: options.target,
    production: options.production,
    checks,
    probes,
    nextActions: ok ? ["forge handoff --json"] : ["check runtime logs", "forge deploy check --production --json"],
    exitCode: ok ? 0 : 1,
  };
}

export async function runDeployCommand(options: DeployCommandOptions): Promise<DeployCommandResult> {
  if (options.subcommand === "plan") return buildPlan(options);
  if (options.subcommand === "check") return buildChecks(options);
  if (options.subcommand === "render" || options.subcommand === "package") return renderDocker(options);
  return verifyUrl(options);
}

export function formatDeployJson(result: DeployCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDeployHuman(result: DeployCommandResult): string {
  const lines = [
    `deploy ${result.action} ${result.ok ? "ok" : "failed"}`,
    `target: ${result.target}`,
    ...result.checks.map((check) => `${check.ok ? "ok" : check.severity === "warning" ? "warn" : "fail"} ${check.name}: ${check.message}`),
    ...(result.files?.length ? ["", "Files:", ...result.files.map((file) => `  ${file}`)] : []),
    ...(result.plan ? ["", result.plan.summary, "", "Commands:", ...result.plan.commands.map((command) => `  ${command}`)] : []),
    ...(result.nextActions.length ? ["", "Next:", ...result.nextActions.map((action) => `  ${action}`)] : []),
  ];
  return `${lines.join("\n")}\n`;
}
