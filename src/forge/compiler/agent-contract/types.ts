import type { Diagnostic } from "../types/diagnostic.ts";
import type { PackageRuntimeCompatibility, RuntimeTypeMismatch } from "../types/package-graph.ts";
import type { RuntimeContext } from "../types/runtime.ts";

export interface AgentProjectInfo {
  name: string;
  type: "forgeos-app";
  template?: string;
}

export interface AgentEntryInfo {
  name: string;
  file: string;
  policy?: string;
  allowedPackages: string[];
  forbiddenCapabilities: string[];
  http: AgentHttpEndpointInfo;
  frontend: AgentFrontendUsageInfo;
}

export interface AgentHttpEndpointInfo {
  method: "GET" | "POST";
  path: string;
  exampleUrl?: string;
  exampleBody?: unknown;
}

export interface AgentFrontendUsageInfo {
  hook: string;
  routes: string[];
  components: string[];
}

export interface AgentFrontendRuntimeBindingInfo {
  kind: "command" | "query" | "liveQuery";
  name: string;
  file: string;
  route?: string;
  component?: string;
  hook: string;
  http: AgentHttpEndpointInfo;
  policy?: string;
  tablesRead: string[];
  tablesWritten: string[];
  emits: string[];
  dependencies: Array<{ table: string; scope: "tenant" | "global" }>;
}

export interface AgentCommandInfo extends AgentEntryInfo {
  tablesRead: string[];
  tablesWritten: string[];
  emits: string[];
}

export interface AgentQueryInfo extends AgentEntryInfo {
  readOnly: true;
  tenantScoped: boolean;
  tablesRead: string[];
}

export interface AgentLiveQueryInfo extends AgentEntryInfo {
  tablesRead: string[];
  dependencies: Array<{ table: string; scope: "tenant" | "global" }>;
}

export interface AgentActionInfo extends AgentEntryInfo {
  event?: string;
  allowedCapabilities: string[];
}

export interface AgentWorkflowInfo {
  name: string;
  file: string;
  trigger?: string;
  steps: string[];
}

export interface AgentTableInfo {
  name: string;
  file: string;
  tenantScoped: boolean;
  tenantField?: string;
  fields: string[];
}

export interface AgentDataInfo {
  tables: AgentTableInfo[];
}

export interface AgentPolicyInfo {
  name: string;
  kind: "roles" | "public" | "system";
  roles: string[];
  file: string;
}

export interface AgentPackageInfo {
  name: string;
  version: string;
  allowedContexts: RuntimeContext[];
  deniedContexts: RuntimeContext[];
}

export interface AgentDependencyApiInfo {
  package: string;
  version: string;
  source: "static" | "static+runtime";
  entrypoints: Array<{
    subpath: string;
    dtsPath: string | null;
    exportCount: number;
    exports: string[];
  }>;
  runtimeCompatibility: PackageRuntimeCompatibility;
  runtimeTypeMismatches: RuntimeTypeMismatch[];
}

export interface AgentIntegrationInfo {
  alias: string;
  packages: string[];
  secrets: string[];
  allowedContexts: RuntimeContext[];
  deniedContexts: RuntimeContext[];
}

export interface AgentSecretInfo {
  name: string;
  integration?: string;
  required: boolean;
  public?: boolean;
  allowedContexts: RuntimeContext[];
}

export interface AgentTelemetryInfo {
  events: string[];
  sinks: string[];
}

export interface AgentAiInfo {
  providers: string[];
  generations: Array<{
    provider: string;
    model: string;
    method: string;
    file: string;
    purpose?: string;
  }>;
  tools: Array<{
    name: string;
    file: string;
    description?: string;
    risk: string;
    strict: boolean;
    needsApproval: boolean | "dynamic";
  }>;
  agents: Array<{
    name: string;
    file: string;
    provider: string;
    model: string;
    instructions?: string;
    tools: string[];
    stopWhen: unknown;
  }>;
}

export interface AgentClientInfo {
  queries: string[];
  commands: string[];
  liveQueries: string[];
  reactHooks: string[];
  transport: Record<string, string>;
}

export interface AgentFrontendInfo {
  present: boolean;
  framework: string;
  root?: string;
  dev?: {
    command: string;
    url: string;
    apiUrlEnv: string;
    defaultApiUrl: string;
  };
  routes: Array<{
    path: string;
    file: string;
    components: string[];
    usesCommands: string[];
    usesQueries: string[];
    usesLiveQueries: string[];
    rawForgeFetches: string[];
  }>;
  components: Array<{
    name: string;
    file: string;
    usesCommands: string[];
    usesQueries: string[];
    usesLiveQueries: string[];
    rawForgeFetches: string[];
  }>;
  providers: Array<{
    name: string;
    file: string;
    apiUrlEnv?: string;
    devAuth: boolean;
    devAuthUserId?: string;
    devAuthTenantId?: string;
    devAuthRole?: string;
  }>;
  bridgeFiles: string[];
  webManifest: {
    present: boolean;
    framework: string;
    root?: string;
    packageManager?: string;
    scripts: {
      dev?: string;
      build?: string;
      typecheck?: string;
    };
    urls: {
      dev?: string;
      api: string;
    };
    env: {
      apiUrl: string;
    };
    bridge: {
      files: string[];
      valid: boolean;
    };
  };
  clientBindings: Array<{
    kind: "command" | "query" | "liveQuery" | "rawFetch";
    name: string;
    file: string;
    route?: string;
    component?: string;
  }>;
  runtimeEndpoints: Array<{
    kind: "command" | "query" | "liveQuery";
    name: string;
    http: AgentHttpEndpointInfo;
    frontend: AgentFrontendUsageInfo;
  }>;
  routeBindings: AgentFrontendRuntimeBindingInfo[];
  componentBindings: AgentFrontendRuntimeBindingInfo[];
  diagnostics: Diagnostic[];
}

export interface AgentAuthInfo {
  modes: Array<"dev-headers" | "jwt" | "oidc" | "disabled">;
  defaultMode: "dev-headers";
  productionDefaultAllowed: false;
  bearerTokenHeader: "Authorization";
  env: {
    mode: string;
    issuer: string;
    audience: string;
    jwksUri: string;
    algorithms: string;
  };
  claims: {
    userId: string;
    tenantId?: string;
    role?: string;
    roles?: string;
    permissions?: string;
    email?: string;
    name?: string;
  };
  requiresTenant: boolean;
}

export interface AgentDeployInfo {
  selfHost: boolean;
  files: string[];
}

export interface AgentRuntimeRule {
  context: "command" | "query" | "liveQuery" | "action" | "workflow";
  allowed: string[];
  forbidden: string[];
}

export type AgentCapabilityStatus = "covered" | "backend-only" | "frontend-only" | "warning";

export interface AgentCapabilityMapEntry {
  id: string;
  status: AgentCapabilityStatus;
  userAction: string;
  ui?: {
    route?: string;
    component?: string;
    file: string;
  };
  runtime?: {
    kind: "command" | "query" | "liveQuery";
    name: string;
    hook: string;
    http: AgentHttpEndpointInfo;
    policy?: string;
    tablesRead: string[];
    tablesWritten: string[];
    emits: string[];
    dependencies: Array<{ table: string; scope: "tenant" | "global" }>;
  };
  notes: string[];
}

export interface AgentCapabilityMap {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  project: AgentProjectInfo;
  summary: {
    covered: number;
    backendOnly: number;
    frontendOnly: number;
    warnings: number;
  };
  entries: AgentCapabilityMapEntry[];
  diagnostics: Diagnostic[];
}

export interface AgentToolRegistry {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  project: AgentProjectInfo;
  explicitTools: AgentAiInfo["tools"];
  autoTools: Array<{
    name: string;
    sourceKind: "command" | "query" | "liveQuery";
    sourceName: string;
    policy?: string;
    file: string;
    http: AgentHttpEndpointInfo;
    frontend: AgentFrontendUsageInfo;
    tablesRead: string[];
    tablesWritten: string[];
    emits: string[];
    dependencies: Array<{ table: string; scope: "tenant" | "global" }>;
    readOnly: boolean;
    requiresAuth: boolean;
    execution: "forge-runtime-endpoint";
  }>;
  agents: AgentAiInfo["agents"];
}

export interface AgentPlaybook {
  title: string;
  steps: string[];
}

export interface AgentContract {
  schemaVersion: string;
  generatorVersion: string;
  project: AgentProjectInfo;
  commands: AgentCommandInfo[];
  queries: AgentQueryInfo[];
  liveQueries: AgentLiveQueryInfo[];
  actions: AgentActionInfo[];
  workflows: AgentWorkflowInfo[];
  data: AgentDataInfo;
  policies: AgentPolicyInfo[];
  packages: AgentPackageInfo[];
  dependencyApis: AgentDependencyApiInfo[];
  integrations: AgentIntegrationInfo[];
  secrets: AgentSecretInfo[];
  telemetry: AgentTelemetryInfo;
  ai: AgentAiInfo;
  client: AgentClientInfo;
  frontend: AgentFrontendInfo;
  auth: AgentAuthInfo;
  deploy?: AgentDeployInfo;
  rules: AgentRuntimeRule[];
  playbooks: AgentPlaybook[];
  commandsToRun: {
    beforeEditing: string[];
    afterEditing: string[];
    dev: string[];
  };
}
