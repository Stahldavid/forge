import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
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
import type { FrontendGraph } from "../types/frontend-graph.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { AUTH_ENV, DEFAULT_AUTH_CLAIMS } from "../../runtime/auth/config.ts";
import type {
  AgentCapabilityMap,
  AgentCapabilityMapEntry,
  AgentContract,
  AgentFrontendRuntimeBindingInfo,
  AgentFrontendUsageInfo,
  AgentHttpEndpointInfo,
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
  frontendGraph: FrontendGraph;
}

export interface AgentContractArtifacts {
  contract: AgentContract;
  capabilityMap: AgentCapabilityMap;
  agentsMd: string;
  appMapMd: string;
  capabilityMapMd: string;
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
  if (!nodeFileSystem.exists(packagePath)) {
    return { name: "forge-app" };
  }

  try {
    const pkg = JSON.parse((nodeFileSystem.readText(packagePath) ?? "")) as {
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

const DB_READ_OPS = new Set(["all", "count", "find", "first", "get", "list", "where"]);
const DB_WRITE_OPS = new Set(["delete", "insert", "patch", "replace", "update", "upsert"]);

function sourceText(workspaceRoot: string, file: string | undefined): string {
  if (!file) {
    return "";
  }
  const absolute = join(workspaceRoot, file);
  if (!nodeFileSystem.exists(absolute)) {
    return "";
  }
  return nodeFileSystem.readText(absolute) ?? "";
}

function dbTablesForText(
  text: string,
  tableNames: Set<string>,
  ops: Set<string>,
): string[] {
  const tables: string[] = [];
  for (const match of text.matchAll(/ctx\.db\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const table = match[1] ?? "";
    const op = match[2] ?? "";
    if (tableNames.has(table) && ops.has(op)) {
      tables.push(table);
    }
  }
  return uniqueSorted(tables);
}

function dbTablesForFile(
  workspaceRoot: string,
  file: string | undefined,
  tableNames: Set<string>,
  ops: Set<string>,
): string[] {
  return dbTablesForText(sourceText(workspaceRoot, file), tableNames, ops);
}

function emittedEventsForFile(workspaceRoot: string, file: string | undefined): string[] {
  const text = sourceText(workspaceRoot, file);
  return uniqueSorted(
    [...text.matchAll(/ctx\.emit\s*\(\s*["'`]([^"'`]+)["'`]/g)]
      .map((match) => match[1] ?? ""),
  );
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
      title: "Choose the right workflow",
      steps: [
        "Run forge do \"<objective>\" --json when the next command is not obvious.",
        "Use forge do fix --json for failures, forge do verify --json before handoff, and forge do connect-ui --json for frontend wiring.",
        "Follow the returned plan, filesToInspect, risks, and nextAction before using lower-level commands directly.",
      ],
    },
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
        "Run forge make resource <name> --fields name:type --with-ui --yes when the resource should be visible in the web app.",
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
      "Run forge test run --changed --timeout-ms 120000 --json for targeted checks.",
      "Use forge verify --changed for the fast impact gate.",
      "Run forge verify --strict before final handoff.",
      ],
    },
    {
      title: "Repair a failing check",
      steps: [
        "Run forge test run --changed --json.",
        "Run forge repair diagnose --from-last-test-run --json.",
        "Review the failureKind, likelyCause, suggestedRepairs, and confidence.",
        "Apply only high-confidence repairs automatically.",
        "Run forge verify --changed.",
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
        "Run forge dev for the full local loop: generated checks, API runtime, web app, DB, worker, watch, and startup URLs.",
        "Run forge dev --once --json for a one-shot diagnostic cycle.",
        "Use --api-only, --web-only, --no-watch, or --no-worker only when narrowing the loop intentionally.",
        "When a web app exists, forge dev starts the API runtime and the web dev server together and prints both URLs.",
        "Use generated client and React hooks through web/lib/forge.ts.",
      ],
    },
    {
      title: "Add or update frontend",
      steps: [
        "Run forge make ui --framework vite --dry-run --json when the app does not have a web root.",
        "Use web/lib/forge.ts as the generated client bridge.",
        "Mount ForgeProvider once in the web app provider/layout layer; use devAuth for local development.",
        "Use useQuery, useCommand, and useLiveQuery instead of raw /commands or /queries fetches.",
        "Run forge generate so frontendGraph and agentContract include routes and bindings.",
        "Run forge inspect capabilities --json to confirm UI actions map to runtime capabilities.",
        "Run forge dev --once --json and forge doctor --json.",
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

function runtimeSummaryFromBinding(binding: AgentFrontendRuntimeBindingInfo): AgentCapabilityMapEntry["runtime"] {
  return {
    kind: binding.kind,
    name: binding.name,
    hook: binding.hook,
    http: binding.http,
    ...(binding.policy ? { policy: binding.policy } : {}),
    tablesRead: binding.tablesRead,
    tablesWritten: binding.tablesWritten,
    emits: binding.emits,
    dependencies: binding.dependencies,
  };
}

function runtimeEntriesWithoutFrontend(contract: AgentContract): AgentCapabilityMapEntry[] {
  const entries: AgentCapabilityMapEntry[] = [];
  for (const commandEntry of contract.commands) {
    if (commandEntry.frontend.routes.length === 0 && commandEntry.frontend.components.length === 0) {
      entries.push({
        id: `runtime:command:${commandEntry.name}`,
        status: "backend-only",
        userAction: `Call command ${commandEntry.name}`,
        runtime: {
          kind: "command",
          name: commandEntry.name,
          hook: commandEntry.frontend.hook,
          http: commandEntry.http,
          ...(commandEntry.policy ? { policy: commandEntry.policy } : {}),
          tablesRead: commandEntry.tablesRead,
          tablesWritten: commandEntry.tablesWritten,
          emits: commandEntry.emits,
          dependencies: [],
        },
        notes: ["Runtime entry is available to agents even though no frontend usage was detected."],
      });
    }
  }
  for (const queryEntry of contract.queries) {
    if (queryEntry.frontend.routes.length === 0 && queryEntry.frontend.components.length === 0) {
      entries.push({
        id: `runtime:query:${queryEntry.name}`,
        status: "backend-only",
        userAction: `Read query ${queryEntry.name}`,
        runtime: {
          kind: "query",
          name: queryEntry.name,
          hook: queryEntry.frontend.hook,
          http: queryEntry.http,
          ...(queryEntry.policy ? { policy: queryEntry.policy } : {}),
          tablesRead: queryEntry.tablesRead,
          tablesWritten: [],
          emits: [],
          dependencies: [],
        },
        notes: ["Runtime entry is available to agents even though no frontend usage was detected."],
      });
    }
  }
  for (const liveQueryEntry of contract.liveQueries) {
    if (liveQueryEntry.frontend.routes.length === 0 && liveQueryEntry.frontend.components.length === 0) {
      entries.push({
        id: `runtime:liveQuery:${liveQueryEntry.name}`,
        status: "backend-only",
        userAction: `Subscribe to liveQuery ${liveQueryEntry.name}`,
        runtime: {
          kind: "liveQuery",
          name: liveQueryEntry.name,
          hook: liveQueryEntry.frontend.hook,
          http: liveQueryEntry.http,
          ...(liveQueryEntry.policy ? { policy: liveQueryEntry.policy } : {}),
          tablesRead: liveQueryEntry.tablesRead,
          tablesWritten: [],
          emits: [],
          dependencies: liveQueryEntry.dependencies,
        },
        notes: ["Runtime entry is available to agents even though no frontend usage was detected."],
      });
    }
  }
  return entries;
}

function buildCapabilityMap(contract: AgentContract): AgentCapabilityMap {
  const diagnostics: Diagnostic[] = [];
  const coveredEntries: AgentCapabilityMapEntry[] = contract.frontend.routeBindings.map((binding) => ({
    id: `ui:${binding.route ?? "route"}:${binding.kind}:${binding.name}:${binding.file}`,
    status: "covered",
    userAction: `${binding.route ?? "route"} uses ${binding.kind} ${binding.name}`,
    ui: {
      ...(binding.route ? { route: binding.route } : {}),
      ...(binding.component ? { component: binding.component } : {}),
      file: binding.file,
    },
    runtime: runtimeSummaryFromBinding(binding),
    notes: ["Frontend route is connected to a generated Forge runtime hook."],
  }));

  const componentOnlyEntries = contract.frontend.componentBindings
    .filter((binding) => !contract.frontend.routeBindings.some(
      (routeBinding) =>
        routeBinding.kind === binding.kind &&
        routeBinding.name === binding.name &&
        routeBinding.file === binding.file,
    ))
    .map((binding) => ({
      id: `component:${binding.component ?? "component"}:${binding.kind}:${binding.name}:${binding.file}`,
      status: "covered" as const,
      userAction: `${binding.component ?? "component"} uses ${binding.kind} ${binding.name}`,
      ui: {
        ...(binding.component ? { component: binding.component } : {}),
        file: binding.file,
      },
      runtime: runtimeSummaryFromBinding(binding),
      notes: ["Frontend component is connected to a generated Forge runtime hook."],
    }));

  const rawFetchEntries: AgentCapabilityMapEntry[] = contract.frontend.clientBindings
    .filter((binding) => binding.kind === "rawFetch")
    .map((binding) => {
      diagnostics.push(createDiagnostic({
        severity: "warning",
        code: "FORGE_CAPABILITY_RAW_RUNTIME_FETCH",
        message: "frontend uses a raw Forge runtime endpoint instead of generated hooks",
        file: binding.file,
        fixHint: "Replace raw runtime fetches with useCommand, useQuery, or useLiveQuery through the local Forge bridge.",
        suggestedCommands: ["forge do connect-ui --json", "forge inspect capabilities --json"],
        docs: ["src/forge/_generated/capabilityMap.md", "src/forge/_generated/frontendGraph.json"],
      }));
      return {
        id: `raw:${binding.file}:${binding.name}`,
        status: "warning",
        userAction: `Raw runtime fetch ${binding.name}`,
        ui: {
          ...(binding.route ? { route: binding.route } : {}),
          ...(binding.component ? { component: binding.component } : {}),
          file: binding.file,
        },
        notes: ["Raw runtime fetch detected; generated hook parity is not proven."],
      };
    });

  const boundRoutes = new Set(contract.frontend.routeBindings.map((binding) => binding.route).filter(Boolean));
  const routeOnlyEntries: AgentCapabilityMapEntry[] = contract.frontend.routes
    .filter((route) => !boundRoutes.has(route.path))
    .map((route) => ({
      id: `route:${route.path}:${route.file}`,
      status: "frontend-only",
      userAction: `View route ${route.path}`,
      ui: {
        route: route.path,
        file: route.file,
      },
      notes: ["Route has no detected Forge runtime binding. This is fine for static pages, but agents cannot infer a data/action capability from it."],
    }));

  const entries = sorted(
    [
      ...coveredEntries,
      ...componentOnlyEntries,
      ...runtimeEntriesWithoutFrontend(contract),
      ...rawFetchEntries,
      ...routeOnlyEntries,
    ],
    (entry) => entry.id,
  );
  return {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    project: contract.project,
    summary: {
      covered: entries.filter((entry) => entry.status === "covered").length,
      backendOnly: entries.filter((entry) => entry.status === "backend-only").length,
      frontendOnly: entries.filter((entry) => entry.status === "frontend-only").length,
      warnings: entries.filter((entry) => entry.status === "warning").length,
    },
    entries,
    diagnostics,
  };
}

function jsAccess(group: string, name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? `api.${group}.${name}`
    : `api.${group}[${JSON.stringify(name)}]`;
}

function frontendHookFor(kind: "command" | "query" | "liveQuery" | "action", name: string): string {
  if (kind === "command") {
    return `useCommand(${jsAccess("commands", name)})`;
  }
  if (kind === "query") {
    return `useQuery(${jsAccess("queries", name)}, args)`;
  }
  if (kind === "liveQuery") {
    return `useLiveQuery(${jsAccess("liveQueries", name)}, args)`;
  }
  return "no generated React hook; invoke from server/action code";
}

function httpEndpointFor(
  kind: "command" | "query" | "liveQuery" | "action",
  name: string,
): AgentHttpEndpointInfo {
  const encoded = encodeURIComponent(name);
  if (kind === "liveQuery") {
    return {
      method: "GET",
      path: `/live/${encoded}`,
      exampleUrl: `/live/${encoded}?args={}`,
    };
  }
  const collection = kind === "action" ? "actions" : kind === "query" ? "queries" : "commands";
  return {
    method: "POST",
    path: `/${collection}/${encoded}`,
    exampleBody: { args: {} },
  };
}

function frontendUsageFor(
  frontendGraph: FrontendGraph,
  kind: "command" | "query" | "liveQuery" | "action",
  name: string,
): AgentFrontendUsageInfo {
  if (kind === "action") {
    return {
      hook: frontendHookFor(kind, name),
      routes: [],
      components: [],
    };
  }
  const bindings = frontendGraph.clientBindings.filter(
    (binding) => binding.kind === kind && binding.name === name,
  );
  return {
    hook: frontendHookFor(kind, name),
    routes: uniqueSorted(bindings.map((binding) => binding.route ?? "")),
    components: uniqueSorted(bindings.map((binding) => binding.component ?? "")),
  };
}

function frontendRuntimeBindingFor(
  binding: FrontendGraph["clientBindings"][number],
  entries: {
    commands: AgentContract["commands"];
    queries: AgentContract["queries"];
    liveQueries: AgentContract["liveQueries"];
  },
): AgentFrontendRuntimeBindingInfo | null {
  if (binding.kind === "rawFetch") {
    return null;
  }
  if (binding.kind === "command") {
    const entry = entries.commands.find((candidate) => candidate.name === binding.name);
    if (!entry) return null;
    return {
      kind: "command",
      name: binding.name,
      file: binding.file,
      ...(binding.route ? { route: binding.route } : {}),
      ...(binding.component ? { component: binding.component } : {}),
      hook: entry.frontend.hook,
      http: entry.http,
      ...(entry.policy ? { policy: entry.policy } : {}),
      tablesRead: entry.tablesRead,
      tablesWritten: entry.tablesWritten,
      emits: entry.emits,
      dependencies: [],
    };
  }
  if (binding.kind === "query") {
    const entry = entries.queries.find((candidate) => candidate.name === binding.name);
    if (!entry) return null;
    return {
      kind: "query",
      name: binding.name,
      file: binding.file,
      ...(binding.route ? { route: binding.route } : {}),
      ...(binding.component ? { component: binding.component } : {}),
      hook: entry.frontend.hook,
      http: entry.http,
      ...(entry.policy ? { policy: entry.policy } : {}),
      tablesRead: entry.tablesRead,
      tablesWritten: [],
      emits: [],
      dependencies: [],
    };
  }
  const entry = entries.liveQueries.find((candidate) => candidate.name === binding.name);
  if (!entry) return null;
  return {
    kind: "liveQuery",
    name: binding.name,
    file: binding.file,
    ...(binding.route ? { route: binding.route } : {}),
    ...(binding.component ? { component: binding.component } : {}),
    hook: entry.frontend.hook,
    http: entry.http,
    ...(entry.policy ? { policy: entry.policy } : {}),
    tablesRead: entry.tablesRead,
    tablesWritten: [],
    emits: [],
    dependencies: entry.dependencies,
  };
}

function frontendRuntimeBindings(
  frontendGraph: FrontendGraph,
  entries: {
    commands: AgentContract["commands"];
    queries: AgentContract["queries"];
    liveQueries: AgentContract["liveQueries"];
  },
): AgentFrontendRuntimeBindingInfo[] {
  return uniqueSorted(
    frontendGraph.clientBindings
      .map((binding) => frontendRuntimeBindingFor(binding, entries))
      .filter((binding): binding is AgentFrontendRuntimeBindingInfo => binding !== null)
      .map((binding) => JSON.stringify(binding)),
  ).map((binding) => JSON.parse(binding) as AgentFrontendRuntimeBindingInfo);
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
  const tableNames = new Set(input.dataGraph.tables.map((table) => table.name));
  const commandInfos: AgentContract["commands"] = sorted(Object.keys(input.apiSurface.commands), (name) => name).map((name) => {
    const entry = runtimeEntries.get(name);
    const file = entry?.file ?? "";
    return {
      name,
      file,
      policy: authPolicy(commandAuth.get(name)),
      tablesRead: dbTablesForFile(input.workspaceRoot, file, tableNames, DB_READ_OPS),
      tablesWritten: dbTablesForFile(input.workspaceRoot, file, tableNames, DB_WRITE_OPS),
      emits: emittedEventsForFile(input.workspaceRoot, file),
      allowedPackages: entry ? packageNamesForModule(input.appGraph, entry.moduleId) : [],
      forbiddenCapabilities: forbiddenForContext(input.classified, "command"),
      http: httpEndpointFor("command", name),
      frontend: frontendUsageFor(input.frontendGraph, "command", name),
    };
  });
  const queryInfos: AgentContract["queries"] = sorted(input.queryRegistry.queries, (query) => query.name).map((query) => ({
    name: query.name,
    file: query.file,
    policy: authPolicy(queryAuth.get(query.name)),
    readOnly: true,
    tenantScoped: input.tenantScope.tables.length > 0,
    tablesRead: dbTablesForFile(input.workspaceRoot, query.file, tableNames, DB_READ_OPS),
    allowedPackages: packageNamesForModule(input.appGraph, query.moduleId),
    forbiddenCapabilities: forbiddenForContext(input.classified, "query"),
    http: httpEndpointFor("query", query.name),
    frontend: frontendUsageFor(input.frontendGraph, "query", query.name),
  }));
  const liveQueryInfos: AgentContract["liveQueries"] = sorted(input.liveQueryRegistry.liveQueries, (liveQuery) => liveQuery.name).map(
    (liveQuery) => {
      const tablesRead = dbTablesForFile(input.workspaceRoot, liveQuery.file, tableNames, DB_READ_OPS);
      return {
        name: liveQuery.name,
        file: liveQuery.file,
        policy: liveQueryPolicy.get(liveQuery.name),
        tablesRead,
        dependencies: (tablesRead.length > 0 ? tablesRead : input.tenantScope.tables.map((table) => table.table)).map((tableName) => ({
          table: tableName,
          scope: tenantTables.has(tableName) ? "tenant" as const : "global" as const,
        })),
        allowedPackages: packageNamesForModule(input.appGraph, liveQuery.moduleId),
        forbiddenCapabilities: forbiddenForContext(input.classified, "liveQuery"),
        http: httpEndpointFor("liveQuery", liveQuery.name),
        frontend: frontendUsageFor(input.frontendGraph, "liveQuery", liveQuery.name),
      };
    },
  );
  const fullStackBindings = frontendRuntimeBindings(input.frontendGraph, {
    commands: commandInfos,
    queries: queryInfos,
    liveQueries: liveQueryInfos,
  });
  const contract: AgentContract = {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    project: {
      name: project.name,
      type: "forgeos-app",
      ...(project.template ? { template: project.template } : {}),
    },
    commands: commandInfos,
    queries: queryInfos,
    liveQueries: liveQueryInfos,
    actions: sorted(
      input.runtimeGraph.entries.filter((entry) => entry.kind === "action"),
      (entry) => entry.name,
    ).map((entry) => ({
      name: entry.name,
      file: entry.file,
      allowedPackages: packageNamesForModule(input.appGraph, entry.moduleId),
      forbiddenCapabilities: [],
      allowedCapabilities: ["network", "secrets", "ai", "db"],
      http: httpEndpointFor("action", entry.name),
      frontend: frontendUsageFor(input.frontendGraph, "action", entry.name),
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
    frontend: {
      present: input.frontendGraph.present,
      framework: input.frontendGraph.framework,
      ...(input.frontendGraph.root ? { root: input.frontendGraph.root } : {}),
      ...(input.frontendGraph.dev ? { dev: input.frontendGraph.dev } : {}),
      routes: input.frontendGraph.routes,
      components: input.frontendGraph.components,
      providers: input.frontendGraph.providers,
      bridgeFiles: input.frontendGraph.bridgeFiles,
      webManifest: input.frontendGraph.webManifest,
      clientBindings: input.frontendGraph.clientBindings,
      runtimeEndpoints: [
        ...sorted(Object.keys(input.apiSurface.commands), (name) => name).map((name) => ({
          kind: "command" as const,
          name,
          http: httpEndpointFor("command", name),
          frontend: frontendUsageFor(input.frontendGraph, "command", name),
        })),
        ...sorted(input.queryRegistry.queries, (query) => query.name).map((query) => ({
          kind: "query" as const,
          name: query.name,
          http: httpEndpointFor("query", query.name),
          frontend: frontendUsageFor(input.frontendGraph, "query", query.name),
        })),
        ...sorted(input.liveQueryRegistry.liveQueries, (liveQuery) => liveQuery.name).map(
          (liveQuery) => ({
            kind: "liveQuery" as const,
            name: liveQuery.name,
            http: httpEndpointFor("liveQuery", liveQuery.name),
            frontend: frontendUsageFor(input.frontendGraph, "liveQuery", liveQuery.name),
          }),
        ),
      ].sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
      routeBindings: fullStackBindings
        .filter((binding) => binding.route)
        .sort((a, b) => `${a.route}:${a.kind}:${a.name}:${a.file}`.localeCompare(`${b.route}:${b.kind}:${b.name}:${b.file}`)),
      componentBindings: fullStackBindings
        .filter((binding) => binding.component)
        .sort((a, b) => `${a.component}:${a.kind}:${a.name}:${a.file}`.localeCompare(`${b.component}:${b.kind}:${b.name}:${b.file}`)),
      diagnostics: input.frontendGraph.diagnostics,
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
      beforeEditing: ["forge do inspect --json", "forge dev --once --json", "forge inspect all --json", "forge check --json"],
      afterEditing: ["forge generate", "forge check", "forge verify --standard", "forge verify --strict"],
      dev: ["forge dev", "forge dev --once --json", "forge do fix --json", "forge do verify --json", "forge dev --api-only", "forge dev --web-only"],
    },
  };

  const existingAgentsPath = join(input.workspaceRoot, "AGENTS.md");
  const existingAgents = nodeFileSystem.exists(existingAgentsPath)
    ? (nodeFileSystem.readText(existingAgentsPath) ?? "")
    : null;
  const userNotes = extractUserNotes(existingAgents);
  const agentsMd = renderAgentsMd(contract, userNotes);
  const capabilityMap = buildCapabilityMap(contract);
  const capabilityMapMd = renderCapabilityMapMd(capabilityMap);
  const appMapMd = renderAppMapMd(contract);
  const runtimeRulesMd = renderRuntimeRulesMd(contract.rules);
  const operationPlaybooksMd = renderOperationPlaybooksMd(contract.playbooks);
  const agentQuickstartMd = renderAgentQuickstartMd();
  const diagnostics = scanAgentContractForLeaks(contract, [
    agentsMd,
    capabilityMapMd,
    appMapMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
  ]);

  return {
    contract,
    capabilityMap,
    agentsMd,
    appMapMd,
    capabilityMapMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
    diagnostics: [...diagnostics, ...capabilityMap.diagnostics],
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

export function serializeCapabilityMapJson(capabilityMap: AgentCapabilityMap): string {
  return serializeCanonical(capabilityMap);
}

export function serializeCapabilityMapTs(capabilityMap: AgentCapabilityMap): string {
  const parsed = JSON.parse(serializeCapabilityMapJson(capabilityMap)) as unknown;
  return `export const capabilityMap = ${JSON.stringify(parsed, null, 2)} as const;\n`;
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
forge do inspect --json
forge dev --once --json
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

Template apps may ignore \`src/forge/_generated/**\` and \`forge.lock\` in git to reduce visual noise. Recreate them with \`forge generate\` before checking, testing, or handing work off.

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
forge do "<objective>" --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge inspect app --json
forge inspect all --json
forge inspect frontend --json
forge inspect capabilities --json
forge auth check --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge inspect live-production --json
forge live status --json
forge doctor
forge agent print-context --json
forge verify --smoke
forge verify --standard
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

## Frontend

- Present: ${contract.frontend.present ? "yes" : "no"}
- Framework: ${contract.frontend.framework}
${contract.frontend.dev ? `- Web URL: ${contract.frontend.dev.url}
- API URL env: \`${contract.frontend.dev.apiUrlEnv}\`
- Web bridge valid: ${contract.frontend.webManifest.bridge.valid ? "yes" : "no"}
- Client bridge: ${contract.frontend.bridgeFiles.length > 0 ? contract.frontend.bridgeFiles.map((file) => `\`${file}\``).join(", ") : "missing"}` : "- Web URL: none"}
- Routes: ${contract.frontend.routes.length}
- Components: ${contract.frontend.components.length}
- Client bindings: ${contract.frontend.clientBindings.length}
- Runtime endpoints: ${contract.frontend.runtimeEndpoints.length}
- Full-stack route bindings: ${contract.frontend.routeBindings.length}

Rules:

- Use the local \`web/**/lib/forge.ts\` bridge to generated hooks.
- Mount \`<ForgeProvider devAuth>\` in local development.
- Use \`useQuery\`, \`useCommand\`, and \`useLiveQuery\` instead of raw Forge endpoint fetches in React components.
- Keep frontend routes reflected in \`src/forge/_generated/frontendGraph.json\`.

## Common tasks

### Choose the right workflow

Use:

\`\`\`bash
forge do "<objective>" --json
forge do fix --json
forge do connect-ui --json
forge do verify --json
\`\`\`

\`forge do\` returns intent, plan, filesToInspect, filesToChange, risks, concrete commands, and nextAction. Prefer it before choosing lower-level CLI commands manually.

### Add a command

1. Add file in \`src/commands\`.
2. Declare \`auth: can("...")\`.
3. Run \`forge generate\`.
4. Run \`forge verify --strict\`.

### Scaffold a resource

Use:

\`\`\`bash
forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json
forge make resource <name> --fields title:text,status:enum(open,closed) --with-ui --yes
forge make ui --framework vite --dry-run --json
\`\`\`

Review the plan before applying when the resource touches schema or policies.

### Check frontend wiring

Use:

\`\`\`bash
forge dev --once --json
forge dev
forge inspect frontend --json
forge inspect capabilities --json
\`\`\`

\`forge dev\` starts the API runtime and web app together when \`web/\` exists. \`forge dev --once --json\` reports routes, components, \`ForgeProvider\`, bridge files, generated client bindings, direct runtime fetch warnings, capability-map parity warnings, and fix hints.

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
forge test run --changed --timeout-ms 120000 --json
forge verify --standard
\`\`\`

Use \`forge verify --standard\` for the normal agent development loop. Finish handoffs with \`forge verify --strict\` when the change is ready.

### Repair a failing check

When a Forge check fails, do not guess. Use:

\`\`\`bash
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
\`\`\`

Apply only high-confidence deterministic repairs automatically. Review medium or low confidence repairs before changing code.

### Export agent adapters

Use:

\`\`\`bash
forge agent export --target generic
forge agent export --target codex
forge agent export --target cursor
forge agent export --target claude
\`\`\`

Adapter files are derived from \`agentContract.json\`, \`appMap.md\`, \`runtimeRules.md\`, \`operationPlaybooks.md\`, and this \`AGENTS.md\`. Do not treat Codex, Cursor, Claude, or custom adapter files as the source of truth.

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
    lines.push(
      `### ${command.name}`,
      `Policy: ${command.policy ?? "none"}`,
      `HTTP: ${command.http.method} ${command.http.path}`,
      `Frontend hook: \`${command.frontend.hook}\``,
      "Frontend routes:",
      ...renderList(command.frontend.routes).split("\n"),
      "Frontend components:",
      ...renderList(command.frontend.components).split("\n"),
      "Writes:",
      ...renderList(command.tablesWritten).split("\n"),
      "Reads:",
      ...renderList(command.tablesRead).split("\n"),
      "Emits:",
      ...renderList(command.emits).split("\n"),
      "",
    );
  }

  lines.push("## Queries", "");
  for (const query of contract.queries) {
    lines.push(
      `### ${query.name}`,
      `Policy: ${query.policy ?? "none"}`,
      `HTTP: ${query.http.method} ${query.http.path}`,
      `Frontend hook: \`${query.frontend.hook}\``,
      `Read-only: ${query.readOnly ? "yes" : "no"}`,
      "Reads:",
      ...renderList(query.tablesRead).split("\n"),
      "Frontend routes:",
      ...renderList(query.frontend.routes).split("\n"),
      "Frontend components:",
      ...renderList(query.frontend.components).split("\n"),
      "",
    );
  }

  lines.push("## Live Queries", "");
  for (const liveQuery of contract.liveQueries) {
    lines.push(
      `### ${liveQuery.name}`,
      `Policy: ${liveQuery.policy ?? "none"}`,
      `HTTP: ${liveQuery.http.method} ${liveQuery.http.path}`,
      `Frontend hook: \`${liveQuery.frontend.hook}\``,
      "Reads:",
      ...renderList(liveQuery.tablesRead).split("\n"),
      "Frontend routes:",
      ...renderList(liveQuery.frontend.routes).split("\n"),
      "Frontend components:",
      ...renderList(liveQuery.frontend.components).split("\n"),
      "Dependencies:",
      ...renderList(liveQuery.dependencies.map((dep) => `${dep.table} (${dep.scope})`)).split("\n"),
      "",
    );
  }

  lines.push("## Actions", "");
  for (const action of contract.actions) {
    lines.push(`### ${action.name}`, `File: ${action.file}`, "");
  }

  lines.push("## Workflows", "");
  for (const workflow of contract.workflows) {
    lines.push(`### ${workflow.name}`, `Trigger: ${workflow.trigger ?? "manual"}`, "Steps:", ...renderList(workflow.steps).split("\n"), "");
  }

  lines.push("## Frontend", "");
  lines.push(`Present: ${contract.frontend.present ? "yes" : "no"}`);
  lines.push(`Framework: ${contract.frontend.framework}`);
  if (contract.frontend.root) {
    lines.push(`Root: ${contract.frontend.root}`);
  }
  if (contract.frontend.dev) {
    lines.push(`Dev URL: ${contract.frontend.dev.url}`);
    lines.push(`API URL env: ${contract.frontend.dev.apiUrlEnv}`);
  }
  lines.push("");

  lines.push("### Routes", "");
  for (const route of contract.frontend.routes) {
    lines.push(
      `#### ${route.path}`,
      `File: ${route.file}`,
      "Components:",
      ...renderList(route.components).split("\n"),
      "Uses commands:",
      ...renderList(route.usesCommands).split("\n"),
      "Uses queries:",
      ...renderList(route.usesQueries).split("\n"),
      "Uses liveQueries:",
      ...renderList(route.usesLiveQueries).split("\n"),
      "Raw Forge fetches:",
      ...renderList(route.rawForgeFetches).split("\n"),
      "",
    );
  }

  lines.push("### Components", "");
  for (const component of contract.frontend.components) {
    lines.push(
      `#### ${component.name}`,
      `File: ${component.file}`,
      "Uses commands:",
      ...renderList(component.usesCommands).split("\n"),
      "Uses queries:",
      ...renderList(component.usesQueries).split("\n"),
      "Uses liveQueries:",
      ...renderList(component.usesLiveQueries).split("\n"),
      "",
    );
  }

  lines.push("### Client Bindings", "");
  for (const binding of contract.frontend.clientBindings) {
    lines.push(
      `- ${binding.kind} ${binding.name} in ${binding.file}${binding.route ? ` (route ${binding.route})` : ""}${binding.component ? ` (${binding.component})` : ""}`,
    );
  }
  if (contract.frontend.clientBindings.length === 0) {
    lines.push("- none");
  }
  lines.push("");

  lines.push("### Runtime Endpoints", "");
  for (const endpoint of contract.frontend.runtimeEndpoints) {
    lines.push(
      `- ${endpoint.kind} ${endpoint.name}: ${endpoint.http.method} ${endpoint.http.path}; ${endpoint.frontend.hook}`,
    );
  }
  if (contract.frontend.runtimeEndpoints.length === 0) {
    lines.push("- none");
  }
  lines.push("");

  lines.push("### Full-Stack Route Bindings", "");
  for (const binding of contract.frontend.routeBindings) {
    lines.push(
      `- ${binding.route ?? "unknown route"} -> ${binding.hook} -> ${binding.kind} ${binding.name}`,
      `  File: ${binding.file}`,
      `  HTTP: ${binding.http.method} ${binding.http.path}`,
      `  Policy: ${binding.policy ?? "none"}`,
      `  Reads: ${binding.tablesRead.length > 0 ? binding.tablesRead.join(", ") : "none"}`,
      `  Writes: ${binding.tablesWritten.length > 0 ? binding.tablesWritten.join(", ") : "none"}`,
      `  Emits: ${binding.emits.length > 0 ? binding.emits.join(", ") : "none"}`,
    );
  }
  if (contract.frontend.routeBindings.length === 0) {
    lines.push("- none");
  }
  lines.push("");

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

function renderCapabilityMapMd(capabilityMap: AgentCapabilityMap): string {
  const lines = [
    "# Capability Map",
    "",
    `Project: ${capabilityMap.project.name}`,
    "",
    "## Summary",
    "",
    `- Covered: ${capabilityMap.summary.covered}`,
    `- Backend-only: ${capabilityMap.summary.backendOnly}`,
    `- Frontend-only: ${capabilityMap.summary.frontendOnly}`,
    `- Warnings: ${capabilityMap.summary.warnings}`,
    "",
    "## Capabilities",
    "",
  ];
  for (const entry of capabilityMap.entries) {
    lines.push(`### ${entry.id}`, `Status: ${entry.status}`, `User action: ${entry.userAction}`);
    if (entry.ui) {
      lines.push(`UI file: ${entry.ui.file}`);
      if (entry.ui.route) lines.push(`Route: ${entry.ui.route}`);
      if (entry.ui.component) lines.push(`Component: ${entry.ui.component}`);
    }
    if (entry.runtime) {
      lines.push(
        `Runtime: ${entry.runtime.kind} ${entry.runtime.name}`,
        `Hook: ${entry.runtime.hook}`,
        `HTTP: ${entry.runtime.http.method} ${entry.runtime.http.path}`,
        `Policy: ${entry.runtime.policy ?? "none"}`,
        `Reads: ${entry.runtime.tablesRead.length > 0 ? entry.runtime.tablesRead.join(", ") : "none"}`,
        `Writes: ${entry.runtime.tablesWritten.length > 0 ? entry.runtime.tablesWritten.join(", ") : "none"}`,
        `Emits: ${entry.runtime.emits.length > 0 ? entry.runtime.emits.join(", ") : "none"}`,
      );
    }
    lines.push("Notes:", ...renderList(entry.notes).split("\n"), "");
  }
  if (capabilityMap.entries.length === 0) {
    lines.push("- none", "");
  }
  if (capabilityMap.diagnostics.length > 0) {
    lines.push("## Diagnostics", "");
    for (const diagnostic of capabilityMap.diagnostics) {
      lines.push(`- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
    }
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
forge do inspect --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge inspect all --json
forge inspect frontend --json
forge inspect capabilities --json
forge check --json
\`\`\`

Never edit:

\`\`\`txt
src/forge/_generated/**
forge.lock
\`\`\`

If generated files are ignored by git, recreate them with \`forge generate\`.

Always finish with:

\`\`\`bash
forge generate
forge verify --strict
\`\`\`
`);
}
