import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApiSurface } from "../api-surface/build.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { detectCapabilities } from "../classifier/capabilities.ts";
import { detectSecrets } from "../classifier/secrets.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { stripDeterministicHeader } from "../primitives/header.ts";
import { canonicalJson, normalizeNewlines, serializeCanonical } from "../primitives/serialize.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { secretLeakScan } from "../sandbox/secret-scan.ts";
import type { AiRegistry } from "../types/ai-registry.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph } from "../types/data-graph.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type {
  PermissionMatrix,
  PolicyRegistry,
  TenantScope,
} from "../types/policy-registry.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { SecretRegistry } from "../types/secret-registry.ts";
import type {
  TelemetryRegistry,
  TelemetrySinks,
} from "../types/telemetry-registry.ts";
import type { WorkflowRegistry } from "../types/workflow-registry.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type { LiveQueryRegistry } from "../types/live-query-registry.ts";
import type { ClientManifest } from "../client-sdk/build-manifest.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { AUTH_ENV, DEFAULT_AUTH_CLAIMS } from "../../runtime/auth/config.ts";
import type {
  AgentContract,
  AgentIntegrationInfo,
  AgentRuntimeRule,
  AgentPlaybook,
} from "./types.ts";

const AGENTS_USER_START = "<!-- user-notes:start -->";
const AGENTS_USER_END = "<!-- user-notes:end -->";
const DEFAULT_USER_NOTES = "Project-specific notes can go here.";

export interface AgentContractInput {
  workspaceRoot: string;
  appGraph: AppGraph;
  packageGraph: PackageGraph;
  classified: ClassifiedPackage[];
  runtimeGraph: RuntimeGraph;
  dataGraph: DataGraph;
  policyRegistry: PolicyRegistry;
  permissionMatrix: PermissionMatrix;
  tenantScope: TenantScope;
  secretRegistry: SecretRegistry;
  telemetryRegistry: TelemetryRegistry;
  telemetrySinks: TelemetrySinks;
  aiRegistry: AiRegistry;
  queryRegistry: QueryRegistry;
  liveQueryRegistry: LiveQueryRegistry;
  workflowRegistry: WorkflowRegistry;
  apiSurface: ApiSurface;
  clientManifest: ClientManifest;
}

export interface AgentContractArtifacts {
  contract: AgentContract;
  agentsMd: string;
  appMapMd: string;
  runtimeRulesMd: string;
  operationPlaybooksMd: string;
  agentQuickstartMd: string;
  diagnostics: Diagnostic[];
}

function sorted<T>(items: T[], by: (item: T) => string): T[] {
  return [...items].sort((a, b) => by(a).localeCompare(by(b)));
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort();
}

function readPackageInfo(workspaceRoot: string): { name: string; template?: string } {
  const packagePath = join(workspaceRoot, "package.json");
  if (!existsSync(packagePath)) {
    return { name: "forge-app" };
  }

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
      name?: string;
      forge?: { template?: string };
    };
    return {
      name: pkg.name ?? "forge-app",
      template: pkg.forge?.template,
    };
  } catch {
    return { name: "forge-app" };
  }
}

function authPolicy(
  auth: { kind: string; policy?: string } | undefined,
): string | undefined {
  return auth?.kind === "policy" ? auth.policy : auth?.kind;
}

function packageNamesForModule(appGraph: AppGraph, moduleId: string): string[] {
  const node = appGraph.moduleGraph.nodes.find((candidate) => candidate.id === moduleId);
  return uniqueSorted(node?.directPackageImports.map((imp) => imp.packageName) ?? []);
}

function forbiddenForContext(
  classified: ClassifiedPackage[],
  context: RuntimeContext,
): string[] {
  const forbidden = new Set<string>();
  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    const denied = recipe?.contexts.denied ?? pkg.classification.incompatible;
    if (denied.includes(context)) {
      const capabilities = detectCapabilities(pkg.api, recipe ?? undefined);
      for (const [name, status] of Object.entries(capabilities)) {
        if (
          typeof status === "object" &&
          "status" in status &&
          (status.status === "required" || status.status === "forbidden")
        ) {
          forbidden.add(name);
        }
      }
      if ((detectSecrets(pkg.api, recipe ?? undefined).length > 0)) {
        forbidden.add("secrets");
      }
    }
  }
  return uniqueSorted([...forbidden]);
}

function buildIntegrations(classified: ClassifiedPackage[]): AgentIntegrationInfo[] {
  const byAlias = new Map<string, AgentIntegrationInfo>();
  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    if (!recipe) {
      continue;
    }
    const entry = byAlias.get(recipe.alias) ?? {
      alias: recipe.alias,
      packages: [],
      secrets: [],
      allowedContexts: recipe.contexts.allowed,
      deniedContexts: recipe.contexts.denied,
    };
      entry.packages = uniqueSorted([...entry.packages, pkg.api.name]);
      entry.secrets = uniqueSorted([
        ...entry.secrets,
      ...recipe.secrets.map((secret) => secret.envVar),
      ]);
    byAlias.set(recipe.alias, entry);
  }
  return sorted([...byAlias.values()], (entry) => entry.alias);
}

function runtimeRules(): AgentRuntimeRule[] {
  return [
    {
      context: "command",
      allowed: ["ctx.db writes", "ctx.emit", "ctx.telemetry buffered events"],
      forbidden: ["network packages", "ctx.secrets", "ctx.ai", "process.env", "filesystem access"],
    },
    {
      context: "query",
      allowed: ["ctx.db reads", "ctx.telemetry buffered events"],
      forbidden: ["insert/update/delete", "ctx.emit", "ctx.secrets", "ctx.ai", "network integrations"],
    },
    {
      context: "liveQuery",
      allowed: ["ctx.db reads", "tenant-scoped subscriptions"],
      forbidden: ["insert/update/delete", "ctx.emit", "ctx.secrets", "ctx.ai", "network integrations"],
    },
    {
      context: "action",
      allowed: ["ctx.secrets", "integrations", "ctx.ai", "ctx.db reads/writes", "network packages"],
      forbidden: ["uncommitted transactional side effects"],
    },
    {
      context: "workflow",
      allowed: ["durable steps", "ctx.secrets", "integrations", "ctx.ai", "retries"],
      forbidden: ["non-idempotent step behavior without guards"],
    },
  ];
}

function playbooks(): AgentPlaybook[] {
  return [
    {
      title: "Add a command",
      steps: [
        "Add a file under src/commands.",
        "Declare auth with can(\"policy.name\") unless intentionally public/system.",
        "Use ctx.db for transactional writes.",
        "Use ctx.emit for side effects.",
        "Run forge generate.",
        "Run forge verify --strict.",
      ],
    },
    {
      title: "Add a query",
      steps: [
        "Add a file under src/queries.",
        "Keep it read-only.",
        "Declare auth explicitly.",
        "Run forge generate.",
        "Run forge check.",
      ],
    },
    {
      title: "Add a liveQuery",
      steps: [
        "Add a liveQuery under src/queries.",
        "Keep it read-only and tenant-scoped when reading tenant tables.",
        "Run forge generate.",
        "Use forge inspect client --json to confirm client exposure.",
      ],
    },
    {
      title: "Debug a stale liveQuery",
      steps: [
        "Run forge live status --json.",
        "Run forge live invalidations list --json and confirm the table and tenant changed.",
        "Run forge live debug <subscriptionId> --json when a subscription id is available.",
        "Check that _forge_live_invalidations has revisions newer than the last sent snapshot.",
        "Reconnect with Last-Event-ID or ?lastRevision=<revision> to verify resume behavior.",
      ],
    },
    {
      title: "Add a table",
      steps: [
        "Edit src/forge/schema.ts.",
        "Include tenantId for tenant-scoped data.",
        "Run forge generate.",
        "Run forge db diff.",
        "Run forge verify --strict.",
      ],
    },
    {
      title: "Scaffold a resource",
      steps: [
        "Run forge make resource <name> --fields name:type,status:enum(open,closed) --dry-run --json.",
        "Review the plan and diagnostics.",
        "Run forge make resource <name> --fields name:type --yes.",
        "Run forge generate.",
        "Run forge verify --strict.",
      ],
    },
    {
      title: "Apply a feature blueprint",
      steps: [
        "Write a JSON blueprint under .forge/blueprints.",
        "Run forge feature validate <blueprint> --json.",
        "Run forge feature plan <blueprint>.",
        "Review the plan, impact, and risk.",
        "Run forge feature apply <blueprint> --yes.",
        "Run forge verify --strict.",
      ],
    },
    {
      title: "Safely refactor a feature",
      steps: [
        "Run forge refactor rename field <table.field> <table.field> --dry-run --json.",
        "Review filesToModify, migrationPlan, diagnostics, and risk.",
        "Use --allow-high-risk only for intentional high-risk refactors.",
        "Apply with forge refactor rename field <table.field> <table.field> --yes.",
        "Run forge generate.",
        "Run forge verify --strict.",
      ],
    },
    {
      title: "Plan impact-based tests",
      steps: [
        "Run forge impact --changed --json.",
        "Run forge test plan --changed --json.",
        "Run forge test run --changed --json for targeted checks.",
        "Use forge verify --changed for the fast impact gate.",
        "Run forge verify --strict before final handoff.",
      ],
    },
    {
      title: "Add a package",
      steps: [
        "Use forge add <alias>.",
        "Do not install packages manually unless the architecture exception is intentional.",
        "Run forge generate.",
        "Run forge check.",
      ],
    },
    {
      title: "Upgrade a package",
      steps: [
        "Run forge deps upgrade-plan <package> --to latest.",
        "Read .forge/upgrades/.../plan.md.",
        "If risk is high, inspect affected files and generated adapters before applying.",
        "Apply with forge deps upgrade-apply <plan>.",
        "Finish with forge verify --strict.",
      ],
    },
    {
      title: "Debug a policy error",
      steps: [
        "Capture the traceId from the response or frontend.",
        "Run forge telemetry inspect <traceId>.",
        "Run forge policy simulate <policy> --role <role>.",
      ],
    },
    {
      title: "Run dev",
      steps: [
        "Run forge dev --db pglite --worker --telemetry local --mock-ai.",
        "Use generated client and React hooks from src/forge/_generated.",
      ],
    },
    {
      title: "Self-host",
      steps: [
        "Run forge self-host compose.",
        "Review deploy/.env.example.",
        "Run forge self-host check.",
      ],
    },
    {
      title: "Debug a production stack trace",
      steps: [
        "Run forge release inspect <releaseId> --json.",
        "Run forge release sourcemaps symbolicate --input stacktrace.json --json.",
        "Open the original source file and line from the symbolicated frame.",
        "Use forge telemetry inspect <traceId> --with-release --json when a trace id is available.",
      ],
    },
  ];
}

function extractUserNotes(existing: string | null): string {
  if (!existing) {
    return DEFAULT_USER_NOTES;
  }
  const body = stripDeterministicHeader(existing);
  const start = body.indexOf(AGENTS_USER_START);
  const end = body.indexOf(AGENTS_USER_END);
  if (start === -1 || end === -1 || end < start) {
    return DEFAULT_USER_NOTES;
  }
  return body.slice(start + AGENTS_USER_START.length, end).trim() || DEFAULT_USER_NOTES;
}

function renderList(items: string[], empty = "none"): string {
  if (items.length === 0) {
    return `- ${empty}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildAgentContractArtifacts(
  input: AgentContractInput,
): AgentContractArtifacts {
  const project = readPackageInfo(input.workspaceRoot);
  const tenantTables = new Map(
    input.tenantScope.tables.map((table) => [table.table, table.tenantIdColumn]),
  );
  const commandAuth = new Map(
    input.policyRegistry.commandAuth.map((binding) => [binding.commandName, binding.auth]),
  );
  const queryAuth = new Map(
    input.policyRegistry.queryAuth.map((binding) => [binding.queryName, binding.auth]),
  );
  const liveQueryPolicy = new Map(
    input.liveQueryRegistry.liveQueries.map((entry) => [entry.name, entry.policy]),
  );

  const runtimeEntries = new Map(input.runtimeGraph.entries.map((entry) => [entry.name, entry]));
  const contract: AgentContract = {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    project: {
      name: project.name,
      type: "forgeos-app",
      ...(project.template ? { template: project.template } : {}),
    },
    commands: sorted(Object.keys(input.apiSurface.commands), (name) => name).map((name) => {
      const entry = runtimeEntries.get(name);
      return {
        name,
        file: entry?.file ?? "",
        policy: authPolicy(commandAuth.get(name)),
        tablesWritten: [],
        emits: [],
        allowedPackages: entry ? packageNamesForModule(input.appGraph, entry.moduleId) : [],
        forbiddenCapabilities: forbiddenForContext(input.classified, "command"),
      };
    }),
    queries: sorted(input.queryRegistry.queries, (query) => query.name).map((query) => ({
      name: query.name,
      file: query.file,
      policy: authPolicy(queryAuth.get(query.name)),
      readOnly: true,
      tenantScoped: input.tenantScope.tables.length > 0,
      allowedPackages: packageNamesForModule(input.appGraph, query.moduleId),
      forbiddenCapabilities: forbiddenForContext(input.classified, "query"),
    })),
    liveQueries: sorted(input.liveQueryRegistry.liveQueries, (liveQuery) => liveQuery.name).map(
      (liveQuery) => ({
        name: liveQuery.name,
        file: liveQuery.file,
        policy: liveQueryPolicy.get(liveQuery.name),
        dependencies: input.tenantScope.tables.map((table) => ({
          table: table.table,
          scope: "tenant" as const,
        })),
        allowedPackages: packageNamesForModule(input.appGraph, liveQuery.moduleId),
        forbiddenCapabilities: forbiddenForContext(input.classified, "liveQuery"),
      }),
    ),
    actions: sorted(
      input.runtimeGraph.entries.filter((entry) => entry.kind === "action"),
      (entry) => entry.name,
    ).map((entry) => ({
      name: entry.name,
      file: entry.file,
      allowedPackages: packageNamesForModule(input.appGraph, entry.moduleId),
      forbiddenCapabilities: [],
      allowedCapabilities: ["network", "secrets", "ai", "db"],
    })),
    workflows: sorted(input.workflowRegistry.workflows, (workflow) => workflow.name).map(
      (workflow) => ({
        name: workflow.name,
        file: workflow.file,
        trigger: workflow.triggerEventType,
        steps: workflow.steps
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((step) => step.name),
      }),
    ),
    data: {
      tables: sorted(input.dataGraph.tables, (table) => table.name).map((table) => ({
        name: table.name,
        file: table.file,
        tenantScoped: tenantTables.has(table.name),
        ...(tenantTables.has(table.name) ? { tenantField: tenantTables.get(table.name) } : {}),
        fields: uniqueSorted(table.fields.map((field) => field.name)),
      })),
    },
    policies: sorted(input.policyRegistry.policies, (policy) => policy.name).map((policy) => ({
      name: policy.name,
      kind: policy.kind,
      roles: uniqueSorted(policy.roles),
      file: policy.file,
    })),
    packages: sorted(input.packageGraph.packages, (pkg) => pkg.name).map((pkg) => {
      const classified = input.classified.find((entry) => entry.api.name === pkg.name);
      return {
        name: pkg.name,
        version: pkg.version,
        allowedContexts: classified?.classification.compatible ?? [],
        deniedContexts: classified?.classification.incompatible ?? [],
      };
    }),
    integrations: buildIntegrations(input.classified),
    secrets: sorted(input.secretRegistry.secrets, (secret) => secret.name).map((secret) => ({
      name: secret.name,
      integration: secret.integration,
      required: secret.required,
      public: secret.public,
      allowedContexts: secret.allowedContexts,
    })),
    telemetry: {
      events: uniqueSorted(input.telemetryRegistry.events.map((event) => event.name)),
      sinks: uniqueSorted(input.telemetrySinks.sinks.map((sink) => sink.kind)),
    },
    ai: {
      providers: uniqueSorted(input.aiRegistry.providers.map((provider) => provider.id)),
      generations: input.aiRegistry.generations
        .map((generation) => ({
          provider: generation.provider,
          model: generation.model,
          method: generation.method,
          file: generation.file,
          ...(generation.purpose ? { purpose: generation.purpose } : {}),
        }))
        .sort((a, b) => `${a.file}:${a.method}:${a.model}`.localeCompare(`${b.file}:${b.method}:${b.model}`)),
    },
    client: {
      queries: input.clientManifest.queries,
      commands: input.clientManifest.commands,
      liveQueries: input.clientManifest.liveQueries,
      reactHooks: input.clientManifest.react.hooks,
      transport: input.clientManifest.transport,
    },
    auth: {
      modes: ["dev-headers", "jwt", "oidc", "disabled"],
      defaultMode: "dev-headers",
      productionDefaultAllowed: false,
      bearerTokenHeader: "Authorization",
      env: {
        mode: AUTH_ENV.mode,
        issuer: AUTH_ENV.issuer,
        audience: AUTH_ENV.audience,
        jwksUri: AUTH_ENV.jwksUri,
        algorithms: AUTH_ENV.algorithms,
      },
      claims: DEFAULT_AUTH_CLAIMS,
      requiresTenant: input.tenantScope.tables.length > 0,
    },
    deploy: {
      selfHost: true,
      files: [
        "deploy/docker-compose.yml",
        "deploy/.env.example",
        "deploy/deployManifest.json",
      ],
    },
    rules: runtimeRules(),
    playbooks: playbooks(),
    commandsToRun: {
      beforeEditing: ["forge inspect all --json", "forge check --json"],
      afterEditing: ["forge generate", "forge check", "forge verify --strict"],
      dev: ["forge dev --db pglite --worker --telemetry local --mock-ai"],
    },
  };

  const existingAgentsPath = join(input.workspaceRoot, "AGENTS.md");
  const existingAgents = existsSync(existingAgentsPath)
    ? readFileSync(existingAgentsPath, "utf8")
    : null;
  const userNotes = extractUserNotes(existingAgents);
  const agentsMd = renderAgentsMd(contract, userNotes);
  const appMapMd = renderAppMapMd(contract);
  const runtimeRulesMd = renderRuntimeRulesMd(contract.rules);
  const operationPlaybooksMd = renderOperationPlaybooksMd(contract.playbooks);
  const agentQuickstartMd = renderAgentQuickstartMd();
  const diagnostics = scanAgentContractForLeaks(contract, [
    agentsMd,
    appMapMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
  ]);

  return {
    contract,
    agentsMd,
    appMapMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
    diagnostics,
  };
}

function scanAgentContractForLeaks(contract: AgentContract, markdown: string[]): Diagnostic[] {
  const serialized = `${canonicalJson(contract)}\n${markdown.join("\n")}`;
  const scan = secretLeakScan(serialized, { includeHighEntropy: false });
  if (!scan.hasLeak) {
    return [];
  }
  return [
    createDiagnostic({
      severity: "error",
      code: "FORGE_AGENT_CONTRACT_SECRET_LEAK",
      message: `agent contract contains secret-like material: ${uniqueSorted(scan.matches).join(", ")}`,
    }),
  ];
}

export function serializeAgentContractJson(contract: AgentContract): string {
  return serializeCanonical(contract);
}

export function serializeAgentContractTs(contract: AgentContract): string {
  const parsed = JSON.parse(serializeAgentContractJson(contract)) as unknown;
  return `export const agentContract = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

function renderAgentsMd(contract: AgentContract, userNotes: string): string {
  const tenantTables = contract.data.tables
    .filter((table) => table.tenantScoped)
    .map((table) => `${table.name} via ${table.tenantField}`);
  const policies = contract.policies.map((policy) =>
    `${policy.name}: ${policy.roles.length > 0 ? policy.roles.join(", ") : policy.kind}`,
  );
  const secrets = contract.secrets.map((secret) => `${secret.name}${secret.required ? " (required)" : " (optional)"}`);

  return normalizeNewlines(`# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named \`${contract.project.name}\`.

## Required workflow

Before editing:

\`\`\`bash
forge inspect all --json
forge check --json
\`\`\`

After editing:

\`\`\`bash
forge generate
forge check
forge verify --strict
\`\`\`

## Do not edit

Do not:

- \`src/forge/_generated/**\`
- \`forge.lock\`
- \`deploy/docker-compose.yml\`, unless changing deployment config intentionally

## Runtime model

- Commands are transactional writes.
- Queries and liveQueries are read-only.
- Actions perform side effects after commit.
- Workflows orchestrate durable steps.
- Production liveQuery uses a durable invalidation log; polling/notify are wakeups only.
- Production API calls use \`Authorization: Bearer <JWT>\` in \`jwt\` or \`oidc\` auth mode.
- \`dev-headers\` auth is for \`forge dev\`, tests, and local agent workflows only.
- AI is only allowed in actions, workflows, endpoints, and server code.
- Secrets are accessed through \`ctx.secrets\`.

## Runtime rules

- Do not import network packages inside \`command\`, \`query\`, or \`liveQuery\`.
- Do not use \`process.env\` directly.
- Do not access cross-tenant data.
- Commands must use \`ctx.emit\` for side effects.
- Actions and workflows handle side effects after commit.
- Do not rely on in-memory Pub/Sub as the source of truth for liveQuery invalidation.

## Useful commands

\`\`\`bash
forge inspect app --json
forge inspect all --json
forge auth check --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge inspect live-production --json
forge live status --json
forge doctor
forge verify --strict
\`\`\`

## Data

Tenant-scoped tables:

${renderList(tenantTables)}

## Policies

${renderList(policies)}

## Secrets

${renderList(secrets)}

## Auth

- Modes: ${contract.auth.modes.join(", ")}
- Production auth: \`jwt\` or \`oidc\`
- Bearer header: \`${contract.auth.bearerTokenHeader}: Bearer <token>\`
- Tenant claim: \`${contract.auth.claims.tenantId ?? "not configured"}\`

## Common tasks

### Add a command

1. Add file in \`src/commands\`.
2. Declare \`auth: can("...")\`.
3. Run \`forge generate\`.
4. Run \`forge verify --strict\`.

### Scaffold a resource

Use:

\`\`\`bash
forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json
forge make resource <name> --fields title:text,status:enum(open,closed) --yes
\`\`\`

Review the plan before applying when the resource touches schema or policies.

### Apply a feature blueprint

Use:

\`\`\`bash
forge feature validate .forge/blueprints/<name>.json --json
forge feature plan .forge/blueprints/<name>.json
forge feature apply .forge/blueprints/<name>.json --yes
\`\`\`

Review high-risk plans before applying. Use \`--allow-high-risk\` only when intentional.

### Safely refactor a feature

Use:

\`\`\`bash
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --yes
\`\`\`

Never edit \`src/forge/_generated/**\` directly. Review migration hints before applying field or table renames.

### Plan impact-based tests

Use:

\`\`\`bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --json
\`\`\`

Finish handoffs with \`forge verify --strict\` when the change is ready.

### Add a package

Use:

\`\`\`bash
forge add <alias>
\`\`\`

Do not install packages manually unless intentional.

### Upgrade a package

Use:

\`\`\`bash
forge deps upgrade-plan <package> --to latest
forge deps upgrade-apply <plan>
forge verify --strict
\`\`\`

Do not manually edit \`package.json\` for package upgrades unless necessary.

### Debug liveQuery

Use:

\`\`\`bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
\`\`\`

Durable invalidations live in \`_forge_live_invalidations\`.

<!-- forge-generated:end -->

${AGENTS_USER_START}

${userNotes}

${AGENTS_USER_END}
`);
}

function renderAppMapMd(contract: AgentContract): string {
  const lines = ["# App Map", "", "## Data", ""];
  for (const table of contract.data.tables) {
    lines.push(`### ${table.name}`, `Tenant-scoped: ${table.tenantScoped ? "yes" : "no"}`);
    if (table.tenantField) {
      lines.push(`Tenant field: ${table.tenantField}`);
    }
    lines.push("Fields:", ...renderList(table.fields).split("\n"), "");
  }

  lines.push("## Commands", "");
  for (const command of contract.commands) {
    lines.push(`### ${command.name}`, `Policy: ${command.policy ?? "none"}`, "Writes:", ...renderList(command.tablesWritten).split("\n"), "Emits:", ...renderList(command.emits).split("\n"), "");
  }

  lines.push("## Queries", "");
  for (const query of contract.queries) {
    lines.push(`### ${query.name}`, `Policy: ${query.policy ?? "none"}`, `Read-only: ${query.readOnly ? "yes" : "no"}`, "");
  }

  lines.push("## Live Queries", "");
  for (const liveQuery of contract.liveQueries) {
    lines.push(`### ${liveQuery.name}`, `Policy: ${liveQuery.policy ?? "none"}`, "Dependencies:", ...renderList(liveQuery.dependencies.map((dep) => `${dep.table} (${dep.scope})`)).split("\n"), "");
  }

  lines.push("## Actions", "");
  for (const action of contract.actions) {
    lines.push(`### ${action.name}`, `File: ${action.file}`, "");
  }

  lines.push("## Workflows", "");
  for (const workflow of contract.workflows) {
    lines.push(`### ${workflow.name}`, `Trigger: ${workflow.trigger ?? "manual"}`, "Steps:", ...renderList(workflow.steps).split("\n"), "");
  }

  return normalizeNewlines(lines.join("\n"));
}

function renderRuntimeRulesMd(rules: AgentRuntimeRule[]): string {
  const lines = [
    "# Runtime Rules",
    "",
    "## LiveQuery Production",
    "",
    "Allowed:",
    "- durable invalidation rows in _forge_live_invalidations",
    "- polling fallback",
    "- Postgres notify wakeups",
    "- SSE heartbeats and Last-Event-ID resume",
    "",
    "Forbidden:",
    "- treating Pub/Sub or in-memory notification as the source of truth",
    "- unbounded snapshot queues",
    "- cross-tenant invalidation fanout",
    "",
  ];
  for (const rule of rules) {
    lines.push(`## ${rule.context}`, "", "Allowed:", ...renderList(rule.allowed).split("\n"), "", "Forbidden:", ...renderList(rule.forbidden).split("\n"), "");
  }
  return normalizeNewlines(lines.join("\n"));
}

function renderOperationPlaybooksMd(playbookEntries: AgentPlaybook[]): string {
  const lines = ["# Operation Playbooks", ""];
  for (const playbook of playbookEntries) {
    lines.push(`## ${playbook.title}`, "");
    for (let index = 0; index < playbook.steps.length; index++) {
      lines.push(`${index + 1}. ${playbook.steps[index]}`);
    }
    lines.push("");
  }
  return normalizeNewlines(lines.join("\n"));
}

function renderAgentQuickstartMd(): string {
  return normalizeNewlines(`# Agent Quickstart

Run:

\`\`\`bash
forge inspect all --json
forge check --json
\`\`\`

Never edit:

\`\`\`txt
src/forge/_generated/**
\`\`\`

Always finish with:

\`\`\`bash
forge generate
forge verify --strict
\`\`\`
`);
}
