import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { ApiSurface } from "../api-surface/build.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { detectCapabilities } from "../classifier/capabilities.ts";
import { detectSecrets } from "../classifier/secrets.ts";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { stripDeterministicHeader } from "../primitives/header.ts";
import { canonicalJson, normalizeNewlines, serializeCanonical } from "../primitives/serialize.ts";
import { toSnakeCase } from "../data-graph/sql/naming.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import {
  defaultRuntimeCompatibility,
} from "../package-graph/oracle.ts";
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
import type {
  ForgeExternalServiceEntry,
  ForgeExternalServiceGraph,
} from "../external-manifest/types.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { CAIR_SCHEMA_VERSION } from "../../cair/types.ts";
import { AUTH_ENV, DEFAULT_AUTH_CLAIMS } from "../../runtime/auth/config.ts";
import {
  forgeCliCommandForWorkspace,
  forgeCliCommandsForWorkspace,
  shouldUseLocalForgeCli,
} from "../../workspace/forge-cli.ts";
import type {
  AgentCapabilityMap,
  AgentCapabilityMapEntry,
  AgentContract,
  AgentDependencyApiInfo,
  AgentExternalEntryInfo,
  AgentFrontendRuntimeBindingInfo,
  AgentFrontendUsageInfo,
  AgentHttpEndpointInfo,
  AgentIntegrationInfo,
  AgentRuntimeRule,
  AgentProtocolInfo,
  AgentToolRegistry,
  AgentPlaybook,
} from "./types.ts";

const AGENTS_USER_START = "<!-- user-notes:start -->";
const AGENTS_USER_END = "<!-- user-notes:end -->";
const DEFAULT_USER_NOTES = "Project-specific notes can go here.";
const AGENTS_USER_NOTES_TOKEN = "__FORGE_AGENTS_USER_NOTES__";

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
  externalServices?: ForgeExternalServiceGraph;
}

export interface AgentContractArtifacts {
  contract: AgentContract;
  capabilityMap: AgentCapabilityMap;
  toolRegistry: AgentToolRegistry;
  agentsMd: string;
  appMapMd: string;
  capabilityMapMd: string;
  agentToolsMd: string;
  runtimeRulesMd: string;
  operationPlaybooksMd: string;
  agentQuickstartMd: string;
  agentCairGuideMd: string;
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

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isWorkspaceChild(workspaceRoot: string, absolutePath: string): boolean {
  const relativePath = relative(resolve(workspaceRoot), absolutePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function localImportSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\b(?:import|export)\s+(type\s+)?(?:[^"'`]*?\s+from\s+)?["'`](\.{1,2}\/[^"'`]+)["'`]/g;
  for (const match of text.matchAll(importPattern)) {
    if (match[1]) {
      continue;
    }
    const specifier = match[2] ?? "";
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return uniqueSorted(specifiers);
}

function resolveLocalImport(workspaceRoot: string, fromFile: string, specifier: string): string | undefined {
  const basePath = normalizeProjectPath(join(dirname(fromFile), specifier));
  const candidates = extname(basePath)
    ? [basePath]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.jsx`,
        `${basePath}.mjs`,
        `${basePath}.cjs`,
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
        join(basePath, "index.js"),
      ];
  for (const candidate of candidates.map(normalizeProjectPath)) {
    if (candidate.includes("/node_modules/") || candidate.startsWith("node_modules/")) {
      continue;
    }
    if (candidate.startsWith("src/forge/_generated/")) {
      continue;
    }
    const absolute = resolve(workspaceRoot, candidate);
    if (!isWorkspaceChild(workspaceRoot, absolute) || !nodeFileSystem.exists(absolute)) {
      continue;
    }
    return normalizeProjectPath(relative(resolve(workspaceRoot), absolute));
  }
  return undefined;
}

function sourceTextWithLocalImports(
  workspaceRoot: string,
  file: string | undefined,
  maxDepth = 2,
): string {
  if (!file) {
    return "";
  }
  const chunks: string[] = [];
  const visited = new Set<string>();

  const visit = (currentFile: string, depth: number): void => {
    const normalizedFile = normalizeProjectPath(currentFile);
    if (visited.has(normalizedFile)) {
      return;
    }
    visited.add(normalizedFile);
    const text = sourceText(workspaceRoot, normalizedFile);
    if (!text) {
      return;
    }
    chunks.push(text);
    if (depth >= maxDepth) {
      return;
    }
    for (const specifier of localImportSpecifiers(text)) {
      const imported = resolveLocalImport(workspaceRoot, normalizedFile, specifier);
      if (imported) {
        visit(imported, depth + 1);
      }
    }
  };

  visit(file, 0);
  return chunks.join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toSnakeCaseName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function toCamelCaseName(name: string): string {
  return name.replace(/[_-]([a-zA-Z0-9])/g, (_match, char: string) => char.toUpperCase());
}

function dbTableLookup(dataGraph: AgentContractInput["dataGraph"]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const table of dataGraph.tables) {
    lookup.set(table.name, table.name);
    lookup.set(table.exportName, table.name);
    lookup.set(toSnakeCaseName(table.name), table.name);
    lookup.set(toSnakeCaseName(table.exportName), table.name);
    lookup.set(toCamelCaseName(table.name), table.name);
    lookup.set(toCamelCaseName(table.exportName), table.name);
  }
  return lookup;
}

function addDbAliasesForText(
  text: string,
  tableLookup: Map<string, string>,
  aliases: Map<string, string>,
): void {
  for (const match of text.matchAll(
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*ctx\.db(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*["'`]([^"'`]+)["'`]\s*\])/g,
  )) {
    const alias = match[1] ?? "";
    const table = match[2] ?? match[3] ?? "";
    const canonicalTable = tableLookup.get(table);
    if (alias && canonicalTable) {
      aliases.set(alias, canonicalTable);
    }
  }

  for (const match of text.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*ctx\.db/g)) {
    const body = match[1] ?? "";
    for (const part of body.split(",")) {
      const [rawTable, rawAlias] = part.split(":").map((value) => value.trim());
      const table = rawTable?.replace(/["'`]/g, "") ?? "";
      const alias = (rawAlias ?? rawTable ?? "").replace(/\s*=.*$/, "").trim();
      const canonicalTable = tableLookup.get(table);
      if (canonicalTable && alias) {
        aliases.set(alias, canonicalTable);
      }
    }
  }
}

function dbHelperOpsForText(text: string): Map<string, Set<string>> {
  const helpers = new Map<string, Set<string>>();
  const patterns = [
    /\b(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>{}]*>)?\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)[\s\S]*?\)\s*(?::[^{]+)?\{/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:<[^>{}]*>\s*)?\(\s*([A-Za-z_$][A-Za-z0-9_$]*)[\s\S]*?\)\s*(?::[^=]+)?=>\s*\{/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1] ?? "";
      const tableParam = match[2] ?? "";
      const start = match.index === undefined ? -1 : match.index + match[0].length;
      if (!name || !tableParam || start < 0) {
        continue;
      }
      let depth = 1;
      let end = start;
      for (; end < text.length; end++) {
        const char = text[end];
        if (char === "{") depth += 1;
        if (char === "}") depth -= 1;
        if (depth === 0) break;
      }
      const body = text.slice(start, end);
      const ops = helpers.get(name) ?? new Set<string>();
      const opPattern = new RegExp(`\\b${escapeRegExp(tableParam)}\\s*\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, "g");
      for (const opMatch of body.matchAll(opPattern)) {
        const op = opMatch[1] ?? "";
        if (DB_READ_OPS.has(op) || DB_WRITE_OPS.has(op)) {
          ops.add(op);
        }
      }
      if (ops.size > 0) {
        helpers.set(name, ops);
      }
    }
  }

  return helpers;
}

function dbTablesForText(
  text: string,
  tableLookup: Map<string, string>,
  ops: Set<string>,
): string[] {
  const tables: string[] = [];
  for (const match of text.matchAll(/ctx\.db\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const table = match[1] ?? "";
    const op = match[2] ?? "";
    const canonicalTable = tableLookup.get(table);
    if (canonicalTable && ops.has(op)) {
      tables.push(canonicalTable);
    }
  }
  for (const match of text.matchAll(/ctx\.db\s*\[\s*["'`]([^"'`]+)["'`]\s*\]\s*\.\s*([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const table = match[1] ?? "";
    const op = match[2] ?? "";
    const canonicalTable = tableLookup.get(table);
    if (canonicalTable && ops.has(op)) {
      tables.push(canonicalTable);
    }
  }
  const aliases = new Map<string, string>();
  addDbAliasesForText(text, tableLookup, aliases);
  for (const [alias, table] of aliases) {
    const aliasPattern = new RegExp(`\\b${escapeRegExp(alias)}\\s*\\.\\s*([A-Za-z_$][A-Za-z0-9_$]*)`, "g");
    for (const match of text.matchAll(aliasPattern)) {
      const op = match[1] ?? "";
      if (ops.has(op)) {
        tables.push(table);
      }
    }
  }
  const helperOps = dbHelperOpsForText(text);
  for (const [helperName, helperTableOps] of helperOps) {
    if (![...helperTableOps].some((op) => ops.has(op))) {
      continue;
    }
    const helperCallPattern = new RegExp(
      `\\b${escapeRegExp(helperName)}\\s*\\(\\s*ctx\\.db(?:\\.([A-Za-z_$][A-Za-z0-9_$]*)|\\[\\s*["'\`]([^"'\`]+)["'\`]\\s*\\])`,
      "g",
    );
    for (const match of text.matchAll(helperCallPattern)) {
      const table = match[1] ?? match[2] ?? "";
      const canonicalTable = tableLookup.get(table);
      if (canonicalTable) {
        tables.push(canonicalTable);
      }
    }
  }
  return uniqueSorted(tables);
}

function dbTablesForFile(
  workspaceRoot: string,
  file: string | undefined,
  tableLookup: Map<string, string>,
  ops: Set<string>,
): string[] {
  return dbTablesForText(sourceTextWithLocalImports(workspaceRoot, file), tableLookup, ops);
}

function emittedEventsForFile(workspaceRoot: string, file: string | undefined): string[] {
  const text = sourceTextWithLocalImports(workspaceRoot, file);
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

function buildDependencyApis(packageGraph: PackageGraph): AgentDependencyApiInfo[] {
  return sorted(packageGraph.packages, (pkg) => pkg.name).map((pkg) => ({
    package: pkg.name,
    version: pkg.version,
    source: pkg.source,
    entrypoints: sorted(pkg.entrypoints, (entrypoint) => entrypoint.subpath).map((entrypoint) => ({
      subpath: entrypoint.subpath,
      dtsPath: entrypoint.dtsPath,
      exportCount: entrypoint.exports.length,
      exports: uniqueSorted(entrypoint.exports.map((exported) => exported.name)),
    })),
    runtimeCompatibility: pkg.runtimeCompatibility ?? defaultRuntimeCompatibility(),
    runtimeTypeMismatches: pkg.runtimeTypeMismatches ?? [],
  }));
}

function runtimeRules(): AgentRuntimeRule[] {
  return [
    {
      context: "command",
      allowed: ["ctx.db writes", "ctx.emit", "ctx.telemetry buffered events"],
      forbidden: ["network packages", "ctx.secrets", "ctx.ai", "ctx.ai.runAgent", "ctx.agent.run", "direct secret/env access", "filesystem access"],
    },
    {
      context: "query",
      allowed: ["ctx.db reads", "ctx.telemetry buffered events"],
      forbidden: ["insert/update/delete", "ctx.emit", "ctx.secrets", "ctx.ai", "ctx.ai.runAgent", "ctx.agent.run", "network integrations"],
    },
    {
      context: "liveQuery",
      allowed: ["ctx.db reads", "tenant-scoped subscriptions"],
      forbidden: ["insert/update/delete", "ctx.emit", "ctx.secrets", "ctx.ai", "ctx.ai.runAgent", "ctx.agent.run", "network integrations"],
    },
    {
      context: "action",
      allowed: ["ctx.secrets", "integrations", "ctx.ai", "ctx.ai.runAgent", "ctx.agent.run", "AI SDK tools", "ctx.db reads/writes", "network packages"],
      forbidden: ["uncommitted transactional side effects"],
    },
    {
      context: "workflow",
      allowed: ["durable steps", "ctx.secrets", "integrations", "ctx.ai", "ctx.ai.runAgent", "ctx.agent.run", "AI SDK ToolLoopAgent", "retries"],
      forbidden: ["non-idempotent step behavior without guards"],
    },
  ];
}

type TenantTableInfo = {
  tenantIdColumn: string;
  tenantField: string;
};

function buildTenantTableLookup(tenantScope: TenantScope, dataGraph: DataGraph): Map<string, TenantTableInfo> {
  const lookup = new Map<string, TenantTableInfo>();
  for (const scoped of tenantScope.tables) {
    const table = dataGraph.tables.find((candidate) =>
      candidate.name === scoped.table ||
      candidate.exportName === scoped.exportName ||
      toSnakeCase(candidate.name) === scoped.table ||
      toSnakeCase(candidate.exportName) === scoped.table
    );
    const tenantField = table?.fields.find((field) => toSnakeCase(field.name) === scoped.tenantIdColumn)?.name ??
      scoped.tenantIdColumn;
    const info = { tenantIdColumn: scoped.tenantIdColumn, tenantField };
    for (const key of uniqueSorted([
      scoped.table,
      scoped.exportName,
      table?.name,
      table?.exportName,
    ].filter((key): key is string => typeof key === "string" && key.length > 0))) {
      lookup.set(key, info);
    }
  }
  return lookup;
}

function agentProtocols(workspaceRoot: string): AgentProtocolInfo[] {
  return [
    {
      id: "cair",
      kind: "agent-protocol",
      version: CAIR_SCHEMA_VERSION,
      guide: "src/forge/_generated/agentCairGuide.md",
      commands: forgeCliCommandsForWorkspace(workspaceRoot, [
        "forge cair snapshot",
        "forge cair query \"Q ST\"",
        "forge cair query \"Q S name=<symbol>\"",
        "forge cair query \"Q D S#1\"",
        "forge cair query \"Q R S#1\"",
        "forge cair query \"Q I S#1\"",
        "forge cair action --plan \"A RN t=S#1 nn=<newName>\"",
        "forge cair action \"A APPLY plan=<P#|path>\"",
        "forge cair action \"A ROLLBACK journal=<path>\"",
      ]),
      preferredFor: [
        "compact repository orientation",
        "symbol lookup before file reads",
        "semantic code edits",
        "guarded refactors",
        "Forge-native feature creation",
        "impact-aware test selection",
        "token-efficient programming",
      ],
      readQueries: [
        "Q ST",
        "Q S name=<symbol>",
        "Q D S#1",
        "Q R S#1",
        "Q I S#1",
        "Q T S#1",
        "Q DEP.API package=<pkg> symbol=<export>",
      ],
      mutationActions: [
        "A RN t=S#1 nn=<newName>",
        "A MV t=S#1 to=<path>",
        "A OI f=M#1",
        "A FMT f=M#1",
        "A MC n=<command>",
        "A MQ n=<query>",
        "A MA n=<action>",
        "A MT n=<table> fields=<fields>",
        "A AT t=S#1 kind=unit",
        "A WX t=S#1 file=src/index.ts",
        "A APPLY plan=<P#|path>",
        "A ROLLBACK journal=<path>",
      ],
      compactAliases: [
        "Q ST=Q STATUS",
        "Q S=Q SYMBOL",
        "Q D=Q DEF",
        "Q R=Q REFS",
        "Q I=Q IMPACT",
        "A RN=A RENAME.SYMBOL",
        "A MV=A MOVE.SYMBOL",
        "A OI=A ORGANIZE.IMPORTS",
        "A FMT=A FORMAT",
        "A MC=A MAKE.COMMAND",
        "A MT=A MAKE.TABLE",
        "A AT=A ADD.TEST",
        "A WX=A WIRE.EXPORT",
      ],
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
      title: "Add an AI tool",
      steps: [
        "Add a server-only file under src/ai or src/tools.",
        "Export aiTool({ description, inputSchema, outputSchema, risk, needsApproval, handler }).",
        "Use zod schemas for inputSchema and outputSchema.",
        "Access secrets through the tool context, not process.env.",
        "Mark destructive or external side effects with risk and needsApproval.",
        "Run forge generate and inspect src/forge/_generated/aiRegistry.json.",
      ],
    },
    {
      title: "Add an agent",
      steps: [
        "Export agent({ provider, model, instructions, tools, stopWhen }) from server-only source.",
        "Prefer AI SDK ToolLoopAgent semantics through ctx.agent.run or ctx.ai.runAgent instead of custom loops.",
        "Use stopWhen with stepCount or terminal tool calls to prevent unbounded loops.",
        "Run agents only in actions, workflows, endpoints, or server code.",
        "Run forge inspect ai --json or forge agent print-context --json and confirm the generated context lists the agent.",
        "Use forge ai trace <traceId> --json to inspect agent runs and tool calls.",
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
        "Run forge make resource <name> --fields name:type,status:enum=open+closed --dry-run --json.",
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
        "Run forge refactor rename command <oldName> <newName> --dry-run --json when renaming runtime entrypoints.",
        "Rename codemods are AST-aware for extract-action, rename command, rename field, and rename table.",
        "Field renames are scoped to the target table, so tickets.priority only rewrites references linked to tickets.",
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
        "Use forge deps inspect <package> --json and forge deps api <package> <symbol> --json before relying on changed external APIs.",
        "Use forge deps trace <package> --json when exports or type resolution are ambiguous.",
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
        "Use generated client bindings through web/lib/forge.ts, web/src/lib/forge.ts, or Nuxt web/composables/forge.ts.",
      ],
    },
    {
      title: "Add or update frontend",
      steps: [
        "Run forge make ui --framework vite --dry-run --json or forge make ui --framework nuxt --dry-run --json when the app does not have a web root.",
        "Run forge make ai-chat support --dry-run --json to add a chat surface backed by /ai/agents/chat streaming and /ai/agents/run JSON automation.",
        "Use web/lib/forge.ts, web/src/lib/forge.ts, or web/composables/forge.ts as the generated client bridge.",
        "Mount ForgeProvider or install the Nuxt Forge plugin once in the web app provider/layout layer; use devAuth for local development.",
        "Use useQuery/useCommand/useLiveQuery or useForgeQuery/useForgeCommand/useForgeLiveQuery instead of raw /commands or /queries fetches.",
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
        notes: [
          commandEntry.source === "external"
            ? "External runtime entry is imported from a Forge manifest; execution requires an external runtime bridge."
            : "Runtime entry is available to agents even though no frontend usage was detected.",
        ],
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
        notes: [
          queryEntry.source === "external"
            ? "External runtime entry is imported from a Forge manifest; execution requires an external runtime bridge."
            : "Runtime entry is available to agents even though no frontend usage was detected.",
        ],
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

function autoToolName(kind: "command" | "query" | "liveQuery", name: string): string {
  return `forge_${kind}_${name}`.replace(/[^A-Za-z0-9_$]/g, "_");
}

function buildAgentToolRegistry(contract: AgentContract): AgentToolRegistry {
  const autoTools: AgentToolRegistry["autoTools"] = [
    ...contract.commands.map((command) => ({
      name: autoToolName("command", command.name),
      sourceKind: "command" as const,
      sourceName: command.name,
      ...(command.policy ? { policy: command.policy } : {}),
      file: command.file,
      http: command.http,
      frontend: command.frontend,
      tablesRead: command.tablesRead,
      tablesWritten: command.tablesWritten,
      emits: command.emits,
      dependencies: [],
      readOnly: false,
      risk: "write" as const,
      needsApproval: command.source === "external"
        ? command.external?.needsApproval ?? (command.external?.risk !== "read")
        : true,
      requiresAuth: command.policy !== undefined && command.policy !== "public",
      ...(command.source ? { source: command.source } : {}),
      ...(command.external ? { external: command.external } : {}),
      execution: command.source === "external"
        ? "external-runtime-endpoint" as const
        : "forge-runtime-endpoint" as const,
    })),
    ...contract.queries.map((query) => ({
      name: autoToolName("query", query.name),
      sourceKind: "query" as const,
      sourceName: query.name,
      ...(query.policy ? { policy: query.policy } : {}),
      file: query.file,
      http: query.http,
      frontend: query.frontend,
      tablesRead: query.tablesRead,
      tablesWritten: [],
      emits: [],
      dependencies: [],
      readOnly: true,
      risk: "read" as const,
      needsApproval: false,
      requiresAuth: query.policy !== undefined && query.policy !== "public",
      ...(query.source ? { source: query.source } : {}),
      ...(query.external ? { external: query.external } : {}),
      execution: query.source === "external"
        ? "external-runtime-endpoint" as const
        : "forge-runtime-endpoint" as const,
    })),
    ...contract.liveQueries.map((liveQuery) => ({
      name: autoToolName("liveQuery", liveQuery.name),
      sourceKind: "liveQuery" as const,
      sourceName: liveQuery.name,
      ...(liveQuery.policy ? { policy: liveQuery.policy } : {}),
      file: liveQuery.file,
      http: liveQuery.http,
      frontend: liveQuery.frontend,
      tablesRead: liveQuery.tablesRead,
      tablesWritten: [],
      emits: [],
      dependencies: liveQuery.dependencies,
      readOnly: true,
      risk: "read" as const,
      needsApproval: false,
      requiresAuth: liveQuery.policy !== undefined && liveQuery.policy !== "public",
      source: "local" as const,
      execution: "forge-runtime-endpoint" as const,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    project: contract.project,
    explicitTools: contract.ai.tools,
    autoTools,
    agents: contract.ai.agents,
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

function externalEndpointFor(entry: ForgeExternalServiceEntry): AgentHttpEndpointInfo {
  const encodedService = encodeURIComponent(entry.service);
  const encodedName = encodeURIComponent(entry.name);
  const collection = entry.kind === "query" ? "queries" : "commands";
  return {
    method: entry.method ?? "POST",
    path: entry.path ?? `/external/${encodedService}/${collection}/${encodedName}`,
    exampleBody: { args: {} },
  };
}

function externalEntryInfo(entry: ForgeExternalServiceEntry): AgentExternalEntryInfo {
  return {
    service: entry.service,
    language: entry.language,
    ...(entry.framework ? { framework: entry.framework } : {}),
    transport: entry.transport,
    ...(entry.transaction ? { transaction: entry.transaction } : {}),
    ...(entry.risk ? { risk: entry.risk } : {}),
    ...(typeof entry.needsApproval === "boolean" ? { needsApproval: entry.needsApproval } : {}),
    effects: entry.effects ?? [],
    ...(entry.description ? { description: entry.description } : {}),
  };
}

function externalFrontendUsage(entry: ForgeExternalServiceEntry): AgentFrontendUsageInfo {
  return {
    hook: `external manifest '${entry.service}.${entry.name}'; runtime bridge required before client invocation`,
    routes: [],
    components: [],
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
  const tenantTables = buildTenantTableLookup(input.tenantScope, input.dataGraph);
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
  const tableLookup = dbTableLookup(input.dataGraph);
  const externalEntries = input.externalServices?.services.flatMap((service) => service.entries) ?? [];
  const localCommandInfos: AgentContract["commands"] = sorted(Object.keys(input.apiSurface.commands), (name) => name).map((name) => {
    const entry = runtimeEntries.get(name);
    const file = entry?.file ?? "";
    return {
      name,
      file,
      source: "local" as const,
      policy: authPolicy(commandAuth.get(name)),
      tablesRead: dbTablesForFile(input.workspaceRoot, file, tableLookup, DB_READ_OPS),
      tablesWritten: dbTablesForFile(input.workspaceRoot, file, tableLookup, DB_WRITE_OPS),
      emits: emittedEventsForFile(input.workspaceRoot, file),
      allowedPackages: entry ? packageNamesForModule(input.appGraph, entry.moduleId) : [],
      forbiddenCapabilities: forbiddenForContext(input.classified, "command"),
      http: httpEndpointFor("command", name),
      frontend: frontendUsageFor(input.frontendGraph, "command", name),
    };
  });
  const externalCommandInfos: AgentContract["commands"] = externalEntries
    .filter((entry) => entry.kind === "command")
    .map((entry) => ({
      name: `${entry.service}.${entry.name}`,
      file: `external:${entry.service}`,
      source: "external" as const,
      external: externalEntryInfo(entry),
      ...(entry.policy ? { policy: entry.policy } : {}),
      tablesRead: [],
      tablesWritten: entry.transaction === "read-only" ? [] : [`external:${entry.service}`],
      emits: entry.effects ?? [],
      allowedPackages: [],
      forbiddenCapabilities: [],
      http: externalEndpointFor(entry),
      frontend: externalFrontendUsage(entry),
    }));
  const commandInfos: AgentContract["commands"] = sorted(
    [...localCommandInfos, ...externalCommandInfos],
    (command) => command.name,
  );
  const localQueryInfos: AgentContract["queries"] = sorted(input.queryRegistry.queries, (query) => query.name).map((query) => ({
    name: query.name,
    file: query.file,
    source: "local" as const,
    policy: authPolicy(queryAuth.get(query.name)),
    readOnly: true,
    tenantScoped: input.tenantScope.tables.length > 0,
    tablesRead: dbTablesForFile(input.workspaceRoot, query.file, tableLookup, DB_READ_OPS),
    allowedPackages: packageNamesForModule(input.appGraph, query.moduleId),
    forbiddenCapabilities: forbiddenForContext(input.classified, "query"),
    http: httpEndpointFor("query", query.name),
    frontend: frontendUsageFor(input.frontendGraph, "query", query.name),
  }));
  const externalQueryInfos: AgentContract["queries"] = externalEntries
    .filter((entry) => entry.kind === "query")
    .map((entry) => ({
      name: `${entry.service}.${entry.name}`,
      file: `external:${entry.service}`,
      source: "external" as const,
      external: externalEntryInfo(entry),
      ...(entry.policy ? { policy: entry.policy } : {}),
      readOnly: true as const,
      tenantScoped: entry.tenantScoped ?? false,
      tablesRead: [`external:${entry.service}`],
      allowedPackages: [],
      forbiddenCapabilities: [],
      http: externalEndpointFor(entry),
      frontend: externalFrontendUsage(entry),
    }));
  const queryInfos: AgentContract["queries"] = sorted(
    [...localQueryInfos, ...externalQueryInfos],
    (query) => query.name,
  );
  const liveQueryInfos: AgentContract["liveQueries"] = sorted(input.liveQueryRegistry.liveQueries, (liveQuery) => liveQuery.name).map(
    (liveQuery) => {
      const tablesRead = dbTablesForFile(input.workspaceRoot, liveQuery.file, tableLookup, DB_READ_OPS);
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
  const protocols = agentProtocols(input.workspaceRoot);
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
      tables: sorted(input.dataGraph.tables, (table) => table.name).map((table) => {
        const tenantInfo = tenantTables.get(table.name);
        return {
          name: table.name,
          file: table.file,
          tenantScoped: Boolean(tenantInfo),
          ...(tenantInfo ? { tenantField: tenantInfo.tenantField } : {}),
          fields: uniqueSorted(table.fields.map((field) => field.name)),
        };
      }),
    },
    policies: sorted(input.policyRegistry.policies, (policy) => policy.name).map((policy) => ({
      name: policy.name,
      kind: policy.kind,
      roles: uniqueSorted(policy.roles),
      permissions: uniqueSorted(policy.permissions ?? []),
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
    dependencyApis: buildDependencyApis(input.packageGraph),
    integrations: buildIntegrations(input.classified),
    externalServices: (input.externalServices?.services ?? []).map((service) => ({
      name: service.name,
      language: service.language,
      ...(service.framework ? { framework: service.framework } : {}),
      transport: service.transport,
      ...(service.baseUrl ? { baseUrl: service.baseUrl } : {}),
      ...(service.command ? { command: service.command } : {}),
      ...(service.health ? { health: service.health } : {}),
      commands: sorted(service.entries.filter((entry) => entry.kind === "command"), (entry) => entry.name)
        .map((entry) => `${service.name}.${entry.name}`),
      queries: sorted(service.entries.filter((entry) => entry.kind === "query"), (entry) => entry.name)
        .map((entry) => `${service.name}.${entry.name}`),
    })),
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
      tools: input.aiRegistry.tools.map((tool) => ({
        name: tool.name,
        file: tool.file,
        ...(tool.description ? { description: tool.description } : {}),
        risk: tool.risk,
        strict: tool.strict,
        needsApproval: tool.needsApproval,
      })),
      agents: input.aiRegistry.agents.map((agent) => ({
        name: agent.name,
        file: agent.file,
        provider: agent.provider,
        model: agent.model,
        ...(agent.instructions ? { instructions: agent.instructions } : {}),
        tools: agent.tools,
        stopWhen: agent.stopWhen,
      })),
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
    agentProtocols: protocols,
    commandsToRun: {
      beforeEditing: forgeCliCommandsForWorkspace(input.workspaceRoot, ["forge agent onboard --target codex --json", "forge status --json", "forge changed --json", "forge handoff --json", "forge do inspect --json", "forge cair snapshot", "forge cair query \"Q ST\"", "forge dev --once --json", "forge agent print-context --json", "forge check --json"]),
      afterEditing: forgeCliCommandsForWorkspace(input.workspaceRoot, ["forge generate", "forge check", "forge verify --standard", finalVerifyCommand(input.workspaceRoot)]),
      dev: forgeCliCommandsForWorkspace(input.workspaceRoot, ["forge dev", "forge dev --once --json", "forge handoff --json", "forge do fix --json", "forge do verify --json", "forge dev --api-only", "forge dev --web-only"]),
    },
  };

  const existingAgentsPath = join(input.workspaceRoot, "AGENTS.md");
  const existingAgents = nodeFileSystem.exists(existingAgentsPath)
    ? (nodeFileSystem.readText(existingAgentsPath) ?? "")
    : null;
  const userNotes = extractUserNotes(existingAgents);
  const agentsMd = renderAgentsMd(contract, userNotes, input.workspaceRoot);
  const toolRegistry = buildAgentToolRegistry(contract);
  const capabilityMap = buildCapabilityMap(contract);
  const capabilityMapMd = renderCapabilityMapMd(capabilityMap);
  const agentToolsMd = renderAgentToolsMd(toolRegistry);
  const appMapMd = renderAppMapMd(contract);
  const runtimeRulesMd = renderRuntimeRulesMd(contract.rules);
  const operationPlaybooksMd = renderOperationPlaybooksMd(contract.playbooks);
  const agentQuickstartMd = renderAgentQuickstartMd(input.workspaceRoot);
  const agentCairGuideMd = renderAgentCairGuideMd(contract, input.workspaceRoot);
  const diagnostics = scanAgentContractForLeaks(contract, [
    agentsMd,
    agentToolsMd,
    capabilityMapMd,
    appMapMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
    agentCairGuideMd,
  ]);

  return {
    contract,
    capabilityMap,
    toolRegistry,
    agentsMd,
    appMapMd,
    capabilityMapMd,
    agentToolsMd,
    runtimeRulesMd,
    operationPlaybooksMd,
    agentQuickstartMd,
    agentCairGuideMd,
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

export function serializeAgentToolRegistryJson(registry: AgentToolRegistry): string {
  return serializeCanonical(registry);
}

export function serializeAgentToolRegistryTs(registry: AgentToolRegistry): string {
  const parsed = JSON.parse(serializeAgentToolRegistryJson(registry)) as unknown;
  return `export const agentTools = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

function localizeForgeCliMarkdown(workspaceRoot: string, markdown: string): string {
  return shouldUseLocalForgeCli(workspaceRoot)
    ? markdown.replace(/\bforge (?=[a-z])/g, "node bin/forge.mjs ")
    : markdown;
}

function finalVerifyCommand(workspaceRoot: string): string {
  const command = shouldUseLocalForgeCli(workspaceRoot) ? "forge verify framework" : "forge verify --strict";
  return forgeCliCommandForWorkspace(workspaceRoot, command);
}

function renderAgentsMd(contract: AgentContract, userNotes: string, workspaceRoot: string): string {
  const finalVerify = finalVerifyCommand(workspaceRoot);
  const cliEntrypoint = shouldUseLocalForgeCli(workspaceRoot)
    ? "This is the ForgeOS framework checkout. Use `node bin/forge.mjs ...` so maintainer commands run against this source tree; reserve the global `forge` command for installed-package smoke tests."
    : "Use the installed `forge` command for app workflows.";
  const tenantTables = contract.data.tables
    .filter((table) => table.tenantScoped)
    .map((table) => `${table.name} via ${table.tenantField}`);
  const policies = contract.policies.map((policy) =>
    `${policy.name}: ${policy.roles.length > 0 ? policy.roles.join(", ") : policy.kind}`,
  );
  const secrets = contract.secrets.map((secret) => `${secret.name}${secret.required ? " (required)" : " (optional)"}`);
  const aiTools = contract.ai.tools.map((tool) =>
    `${tool.name}: ${tool.description ?? "no description"} (${tool.risk}${tool.needsApproval ? ", approval" : ""})`,
  );
  const aiAgents = contract.ai.agents.map((agent) =>
    `${agent.name}: ${agent.provider}/${agent.model} with ${agent.tools.length > 0 ? agent.tools.join(", ") : "no tools"}`,
  );

  const generated = localizeForgeCliMarkdown(workspaceRoot, `# AGENTS.md

<!-- forge-generated:start -->

## Project

This is a ForgeOS application named \`${contract.project.name}\`.

## CLI entrypoint

${cliEntrypoint}

## Required workflow

Before editing:

\`\`\`bash
forge agent onboard --target codex --json
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge dev --once --json
forge agent print-context --json
forge check --json
\`\`\`

## CAIR first

Before reading large files or hand-writing patches, prefer the generated CAIR guide:

\`\`\`bash
forge cair snapshot
forge cair query "Q ST"
forge cair query "Q S name=<symbol>"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
\`\`\`

Use \`src/forge/_generated/agentCairGuide.md\` for the full compact protocol. Plan CAIR mutations before applying them:

\`\`\`bash
forge cair action --plan "A RN t=S#1 nn=<newName>"
forge cair action "A APPLY plan=<returned-plan-path>"
\`\`\`

After editing:

\`\`\`bash
forge generate
forge check
${finalVerify}
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
- Do not read secrets or server runtime config through \`process.env\` in Forge runtime code; use \`ctx.secrets\` or generated config context. Public frontend bridge env such as \`NEXT_PUBLIC_*\` and \`NUXT_PUBLIC_*\` is allowed in web bridge files.
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
forge handoff --json
forge inspect app --json
forge inspect all --json
forge inspect all --full --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge deps inspect <package> --json
forge deps api <package> <symbol> --json
forge deps trace <package> --json
forge auth check --json
forge inspect runtime-matrix --json
forge inspect policies --json
forge inspect client --json
forge inspect live-production --json
forge live status --json
forge doctor
forge doctor windows --json
forge setup windows --json
forge agent print-context --json
forge agent doctor --target codex --json
forge ai tools --json
forge ai agents --json
forge ai trace <traceId> --json
forge verify --smoke
forge verify --standard
${finalVerify}
\`\`\`

## Data

Tenant-scoped tables:

${renderList(tenantTables)}

## Policies

${renderList(policies)}

## Secrets

${renderList(secrets)}

## AI Tools And Agents

- AI SDK engine: Vercel AI SDK v6.
- Forge layer: generated registry, runtime rules, telemetry, secrets, tenant/auth context, and agent contract.
- Use \`ctx.agent.run\` or \`ctx.ai.runAgent\` only in actions, workflows, endpoints, and server code.
- Do not create custom tool loops; use Forge tools and AI SDK \`ToolLoopAgent\` through the Forge runtime.

Tools:

${renderList(aiTools)}

Agents:

${renderList(aiAgents)}

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

- Use the local \`web/**/lib/forge.ts\` or Nuxt \`web/composables/forge.ts\` bridge to generated bindings.
- Mount \`<ForgeProvider devAuth>\` or install the Nuxt Forge plugin in local development.
- Use \`useQuery\`/\`useCommand\`/\`useLiveQuery\` or \`useForgeQuery\`/\`useForgeCommand\`/\`useForgeLiveQuery\` instead of raw Forge endpoint fetches in components.
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
4. Run \`${finalVerify}\`.

### Scaffold a resource

Use:

\`\`\`bash
forge make resource <name> --fields title:text,status:enum=open+closed --dry-run --json
forge make resource <name> --fields title:text,status:enum=open+closed --with-ui --yes
forge make ui --framework vite --dry-run --json
forge make ui --framework nuxt --dry-run --json
forge make ai-chat support --dry-run --json
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

\`forge dev\` starts the API runtime and web app together when \`web/\` exists. \`forge dev --once --json\` reports routes, components, providers/plugins, bridge files, generated client bindings, direct runtime fetch warnings, capability-map parity warnings, and fix hints.

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
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename command createTicket openTicket --yes
\`\`\`

These codemods are AST-aware for \`extract-action\`, \`rename command\`, \`rename field\`, and \`rename table\`. Command renames update runtime registries, generated client references, frontend hooks, tests, and string references where safe. Field renames are scoped to the target table, so \`tickets.priority\` only rewrites references linked to \`tickets\`.

Never edit \`src/forge/_generated/**\` directly. Review migration hints before applying command, field, or table renames.

### Plan impact-based tests

Use:

\`\`\`bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge verify --standard
\`\`\`

Use \`forge verify --standard\` for the normal agent development loop. Finish handoffs with \`${finalVerify}\` when the change is ready.

### Repair a failing check

When a Forge check fails, do not guess. Use:

\`\`\`bash
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
\`\`\`

Apply only high-confidence deterministic repairs automatically. Review medium or low confidence repairs before changing code.

### Add AI tools or agents

Use:

\`\`\`bash
forge generate
forge inspect ai --json
forge agent print-context --json
forge ai check --json
forge ai trace <traceId> --json
\`\`\`

Define tools with \`aiTool({ inputSchema, outputSchema, risk, needsApproval, handler })\` and agents with \`agent({ provider, model, instructions, tools, stopWhen })\`. Execute agents with \`ctx.agent.run\` or \`ctx.ai.runAgent\` only from actions, workflows, endpoints, or server code. In dev, POST \`/ai/agents/run\` returns JSON for automation and POST \`/ai/agents/chat\` returns an AI SDK UIMessage stream for React \`useChat\`; both accept \`agent: "<exportedAgentName>"\` and use generated auto-tools from \`agentTools.json\`.

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
forge deps inspect <package> --json
forge deps api <package> <symbol> --json
forge deps upgrade-apply <plan>
${finalVerify}
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

${AGENTS_USER_NOTES_TOKEN}

${AGENTS_USER_END}
`);
  return normalizeNewlines(generated.replace(AGENTS_USER_NOTES_TOKEN, () => userNotes));
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

  lines.push("## AI", "");
  lines.push("### Providers", "", ...renderList(contract.ai.providers).split("\n"), "");
  lines.push("### Generations", "");
  for (const generation of contract.ai.generations) {
    lines.push(
      `- ${generation.method}: ${generation.provider}/${generation.model} in ${generation.file}${generation.purpose ? ` (${generation.purpose})` : ""}`,
    );
  }
  if (contract.ai.generations.length === 0) {
    lines.push("- none");
  }
  lines.push("", "### Tools", "");
  for (const tool of contract.ai.tools) {
    lines.push(
      `#### ${tool.name}`,
      `File: ${tool.file}`,
      `Risk: ${tool.risk}`,
      `Strict: ${tool.strict ? "yes" : "no"}`,
      `Needs approval: ${String(tool.needsApproval)}`,
      `Description: ${tool.description ?? "none"}`,
      "",
    );
  }
  if (contract.ai.tools.length === 0) {
    lines.push("- none", "");
  }
  lines.push("### Agents", "");
  for (const agent of contract.ai.agents) {
    lines.push(
      `#### ${agent.name}`,
      `File: ${agent.file}`,
      `Model: ${agent.provider}/${agent.model}`,
      "Tools:",
      ...renderList(agent.tools).split("\n"),
      `Stop when: ${JSON.stringify(agent.stopWhen)}`,
      "",
    );
  }
  if (contract.ai.agents.length === 0) {
    lines.push("- none", "");
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

function renderAgentToolsMd(registry: AgentToolRegistry): string {
  const lines = [
    "# Agent Tools",
    "",
    `Project: ${registry.project.name}`,
    "",
    "## Explicit AI Tools",
    "",
  ];

  for (const tool of registry.explicitTools) {
    lines.push(
      `### ${tool.name}`,
      `File: ${tool.file}`,
      `Risk: ${tool.risk}`,
      `Strict: ${tool.strict ? "yes" : "no"}`,
      `Needs approval: ${String(tool.needsApproval)}`,
      `Description: ${tool.description ?? "none"}`,
      "",
    );
  }
  if (registry.explicitTools.length === 0) {
    lines.push("- none", "");
  }

  lines.push("## Auto Tools From Forge Runtime", "");
  for (const tool of registry.autoTools) {
    lines.push(
      `### ${tool.name}`,
      `Source: ${tool.sourceKind} ${tool.sourceName}`,
      `File: ${tool.file}`,
      `HTTP: ${tool.http.method} ${tool.http.path}`,
      `Policy: ${tool.policy ?? "none"}`,
      `Requires auth: ${tool.requiresAuth ? "yes" : "no"}`,
      `Read-only: ${tool.readOnly ? "yes" : "no"}`,
      `Risk: ${tool.risk}`,
      `Needs approval: ${String(tool.needsApproval)}`,
      `Frontend hook: \`${tool.frontend.hook}\``,
      `Reads: ${tool.tablesRead.length > 0 ? tool.tablesRead.join(", ") : "none"}`,
      `Writes: ${tool.tablesWritten.length > 0 ? tool.tablesWritten.join(", ") : "none"}`,
      `Emits: ${tool.emits.length > 0 ? tool.emits.join(", ") : "none"}`,
      "",
    );
  }
  if (registry.autoTools.length === 0) {
    lines.push("- none", "");
  }

  lines.push("## Agents", "");
  for (const agent of registry.agents) {
    lines.push(
      `### ${agent.name}`,
      `File: ${agent.file}`,
      `Model: ${agent.provider}/${agent.model}`,
      `Tools: ${agent.tools.length > 0 ? agent.tools.join(", ") : "none"}`,
      `Stop when: ${JSON.stringify(agent.stopWhen)}`,
      "",
    );
  }
  if (registry.agents.length === 0) {
    lines.push("- none", "");
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

function renderAgentQuickstartMd(workspaceRoot: string): string {
  const finalVerify = finalVerifyCommand(workspaceRoot);
  return normalizeNewlines(localizeForgeCliMarkdown(workspaceRoot, `# Agent Quickstart

Run:

\`\`\`bash
forge agent onboard --target codex --json
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge agent print-context --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge inspect all --json
forge check --json
forge ai trace <traceId> --json
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
${finalVerify}
\`\`\`
`));
}

function renderAgentCairGuideMd(contract: AgentContract, workspaceRoot: string): string {
  const cair = contract.agentProtocols.find((protocol) => protocol.id === "cair");
  const finalVerify = finalVerifyCommand(workspaceRoot);
  const summary = [
    `commands=${contract.commands.length}`,
    `queries=${contract.queries.length}`,
    `liveQueries=${contract.liveQueries.length}`,
    `actions=${contract.actions.length}`,
    `workflows=${contract.workflows.length}`,
    `tables=${contract.data.tables.length}`,
  ].join(" ");
  return normalizeNewlines(localizeForgeCliMarkdown(workspaceRoot, `# CAIR Agent Guide

Project: ${contract.project.name}
CAIR version: ${cair?.version ?? CAIR_SCHEMA_VERSION}
Surface: ${summary}

CAIR is the compact agent protocol for reading and changing this Forge workspace. Use it before opening whole files when symbol, module, dependency, test, or impact context is enough.

## First commands

\`\`\`bash
forge cair snapshot
forge cair query "Q ST"
\`\`\`

The snapshot emits compact ids:

- \`M#\` modules/files
- \`S#\` symbols
- \`P#\` packages
- \`API#\` dependency APIs
- \`T#\` tests

## Read before editing

\`\`\`bash
forge cair query "Q S name=<symbol>"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
forge cair query "Q T S#1"
forge cair query "Q DEP.API package=<pkg> symbol=<export>"
\`\`\`

Only open source files after CAIR shows that the exact file or body is needed.

## Plan, apply, rollback

Never apply semantic mutations first. Create a plan:

\`\`\`bash
forge cair action --plan "A RN t=S#1 nn=<newName>"
\`\`\`

Apply the returned plan path:

\`\`\`bash
forge cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
\`\`\`

Keep returned journal paths for rollback:

\`\`\`bash
forge cair action "A ROLLBACK journal=.forge/cair/journal/<journal>.json"
\`\`\`

## Semantic actions

\`\`\`txt
A RN t=S#1 nn=<newName>
A MV t=S#1 to=src/target.ts
A SIG t=S#1 signature="export function x(input: string): boolean"
A PARAM t=S#1 name=tenantId type=string default="defaultTenant"
A CALLS t=S#1 appendArg="defaultTenant"
A OI f=M#1
A FMT f=M#1
\`\`\`

For high-risk semantic actions, include expectations when available:

\`\`\`txt
expect.file=src/path.ts
expect.kind=command
expect.hash=<sha256>
\`\`\`

## Forge-native actions

Prefer Forge-native CAIR actions over hand-writing boilerplate:

\`\`\`txt
A MC n=createTicket
A MQ n=listTickets
A MA n=chargeCustomer
A MT n=tickets fields=title:text,status:text
A AT t=S#1 kind=unit
A WX t=S#1 file=src/index.ts
\`\`\`

## Compact aliases

Queries:

\`\`\`txt
Q ST  = Q STATUS
Q S   = Q SYMBOL
Q D   = Q DEF
Q R   = Q REFS
Q I   = Q IMPACT
Q M   = Q MODULE
Q T   = Q TESTS
Q API = Q DEP.API
\`\`\`

Actions:

\`\`\`txt
A RN  = A RENAME.SYMBOL
A MV  = A MOVE.SYMBOL
A OI  = A ORGANIZE.IMPORTS
A FMT = A FORMAT
A MC  = A MAKE.COMMAND
A MQ  = A MAKE.QUERY
A MA  = A MAKE.ACTION
A MT  = A MAKE.TABLE
A AT  = A ADD.TEST
A WX  = A WIRE.EXPORT
A AP  = A APPLY
A RB  = A ROLLBACK
\`\`\`

## Verification

After CAIR edits, run the narrowest useful checks:

\`\`\`bash
forge check --json
forge verify --standard
${finalVerify}
\`\`\`

## Constraints

- Do not edit \`src/forge/_generated/**\` unless explicitly allowed.
- Do not bypass \`--plan\` for semantic edits.
- Do not use CAIR as blind text replacement when a semantic action exists.
- Use TypeScript language service, ast-grep, ts-morph, or raw file reads only as implementation backends or fallbacks. CAIR is the agent-facing protocol.
`));
}
