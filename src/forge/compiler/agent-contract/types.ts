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
}

export interface AgentCommandInfo extends AgentEntryInfo {
  tablesWritten: string[];
  emits: string[];
}

export interface AgentQueryInfo extends AgentEntryInfo {
  readOnly: true;
  tenantScoped: boolean;
}

export interface AgentLiveQueryInfo extends AgentEntryInfo {
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
}

export interface AgentClientInfo {
  queries: string[];
  commands: string[];
  liveQueries: string[];
  reactHooks: string[];
  transport: Record<string, string>;
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
  integrations: AgentIntegrationInfo[];
  secrets: AgentSecretInfo[];
  telemetry: AgentTelemetryInfo;
  ai: AgentAiInfo;
  client: AgentClientInfo;
  deploy?: AgentDeployInfo;
  rules: AgentRuntimeRule[];
  playbooks: AgentPlaybook[];
  commandsToRun: {
    beforeEditing: string[];
    afterEditing: string[];
    dev: string[];
  };
}
