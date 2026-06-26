import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";

export type AuthMdSubcommand = "generate" | "check";

export interface AuthMdCommandOptions {
  subcommand: AuthMdSubcommand;
  workspaceRoot: string;
  json: boolean;
  output?: string;
}

export interface AuthMdCommandResult {
  ok: boolean;
  path: string;
  metadataPath: string;
  changed: boolean;
  diagnostics: Array<{ code: string; message: string }>;
  data: {
    commands: number;
    queries: number;
    liveQueries: number;
    actions: number;
    policies: number;
    aiTools: number;
    requiresTenant: boolean;
  };
  exitCode: 0 | 1;
}

interface RuntimeEntry {
  name: string;
  policy?: string;
  requiresAuth?: boolean;
  risk?: string;
  needsApproval?: boolean;
}

interface AgentContractLike {
  project?: { name?: string };
  commands?: RuntimeEntry[];
  queries?: RuntimeEntry[];
  liveQueries?: RuntimeEntry[];
  actions?: RuntimeEntry[];
  policies?: Array<{ name: string; kind?: string; roles?: string[]; permissions?: string[] }>;
  auth?: {
    defaultMode?: string;
    bearerTokenHeader?: string;
    env?: Record<string, string>;
    claims?: Record<string, string | undefined>;
    requiresTenant?: boolean;
  };
}

interface AgentToolsLike {
  tools?: Array<{
    name: string;
    description?: string;
    risk?: string;
    needsApproval?: boolean | "dynamic";
  }>;
}

function readGeneratedJson<T>(workspaceRoot: string, relativePath: string): T | null {
  const absolute = join(workspaceRoot, relativePath);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return JSON.parse(stripDeterministicHeader(readFileSync(absolute, "utf8"))) as T;
}

function outputPath(options: AuthMdCommandOptions): string {
  return options.output?.trim() || "public/auth.md";
}

function listRuntimeEntries(title: string, entries: RuntimeEntry[] | undefined): string[] {
  const rows = (entries ?? []).map((entry) =>
    `| \`${entry.name}\` | ${entry.policy ? `\`${entry.policy}\`` : "none"} | ${
      entry.requiresAuth === false ? "no" : "yes"
    } | ${entry.risk ?? "read"} | ${String(entry.needsApproval ?? false)} |`
  );
  return [
    `## ${title}`,
    "",
    "| Name | Policy | Requires auth | Risk | Needs approval |",
    "|------|--------|---------------|------|----------------|",
    ...(rows.length > 0 ? rows : ["| none | none | no | none | false |"]),
    "",
  ];
}

function existingDocLinks(workspaceRoot: string): string[] {
  const candidates = [
    "README.md",
    "docs/index.md",
    "docs/security-and-data.md",
    "docs/forge-add.md",
    `${GENERATED_DIR}/capabilityMap.md`,
    `${GENERATED_DIR}/operationPlaybooks.md`,
    `${GENERATED_DIR}/docs/workos.md`,
  ];
  const docsDir = join(workspaceRoot, "docs");
  if (existsSync(docsDir)) {
    for (const entry of readdirSync(docsDir).slice(0, 20)) {
      if (entry.endsWith(".md")) {
        candidates.push(`docs/${entry}`);
      }
    }
  }
  return [...new Set(candidates)].filter((path) => existsSync(join(workspaceRoot, path)));
}

function riskMetadata(contract: AgentContractLike | null, tools: AgentToolsLike | null) {
  const runtime = [
    ...(contract?.commands ?? []).map((entry) => ({ kind: "command", ...entry, risk: entry.risk ?? "write" })),
    ...(contract?.queries ?? []).map((entry) => ({ kind: "query", ...entry, risk: entry.risk ?? "read" })),
    ...(contract?.liveQueries ?? []).map((entry) => ({ kind: "liveQuery", ...entry, risk: entry.risk ?? "read" })),
    ...(contract?.actions ?? []).map((entry) => ({ kind: "action", ...entry, risk: entry.risk ?? "external" })),
  ].map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    policy: entry.policy ?? null,
    risk: entry.risk ?? "read",
    needs_approval: entry.needsApproval ?? (entry.kind === "action"),
    requires_auth: entry.requiresAuth !== false,
  }));
  const aiTools = (tools?.tools ?? []).map((tool) => ({
    kind: "aiTool",
    name: tool.name,
    risk: tool.risk ?? "read",
    needs_approval: tool.needsApproval ?? false,
    policy: null,
  }));
  return [...runtime, ...aiTools];
}

function metadataPathFor(markdownPath: string): string {
  const publicPrefix = "public/";
  return markdownPath.startsWith(publicPrefix)
    ? "public/.well-known/oauth-protected-resource"
    : `${dirname(markdownPath)}/.well-known/oauth-protected-resource`;
}

function renderAuthMd(workspaceRoot: string): AuthMdCommandResult & { content: string; metadataContent: string } {
  const contract = readGeneratedJson<AgentContractLike>(
    workspaceRoot,
    `${GENERATED_DIR}/agentContract.json`,
  );
  const tools = readGeneratedJson<AgentToolsLike>(
    workspaceRoot,
    `${GENERATED_DIR}/agentTools.json`,
  );
  const diagnostics: AuthMdCommandResult["diagnostics"] = [];
  if (!contract) {
    diagnostics.push({
      code: "FORGE_AUTHMD_MISSING_AGENT_CONTRACT",
      message: "missing src/forge/_generated/agentContract.json; run forge generate first",
    });
  }

  const auth = contract?.auth;
  const docLinks = existingDocLinks(workspaceRoot);
  const riskRows = riskMetadata(contract, tools);
  const toolRows = (tools?.tools ?? []).map((tool) =>
    `| \`${tool.name}\` | ${tool.description ?? ""} | ${tool.risk ?? "read"} | ${
      String(tool.needsApproval ?? false)
    } |`
  );
  const policyRows = (contract?.policies ?? []).map((policy) =>
    `| \`${policy.name}\` | ${policy.kind ?? "roles"} | ${
      (policy.roles ?? []).map((role) => `\`${role}\``).join(", ") || "none"
    } | ${(policy.permissions ?? []).map((permission) => `\`${permission}\``).join(", ") || "none"} |`
  );
  const scopes = (contract?.policies ?? []).map((policy) => policy.name).sort();
  const actionNames = (contract?.actions ?? []).map((entry) => entry.name).sort();
  const protectedResourceMetadata = {
    resource: "/",
    authorization_servers: ["configured via FORGE_AUTH_ISSUER"],
    bearer_methods_supported: ["header"],
    resource_documentation: "/auth.md",
    scopes_supported: scopes,
    resource_signing_alg_values_supported: auth?.env?.algorithms ? ["RS256"] : undefined,
    forge: {
      app: contract?.project?.name ?? "unknown",
      tenant_required: auth?.requiresTenant ?? false,
      commands: (contract?.commands ?? []).map((entry) => entry.name).sort(),
      queries: (contract?.queries ?? []).map((entry) => entry.name).sort(),
      live_queries: (contract?.liveQueries ?? []).map((entry) => entry.name).sort(),
      actions: actionNames,
      policies: scopes,
      risks: riskRows,
      docs: docLinks.map((path) => `/${path}`),
      ai_tools: (tools?.tools ?? []).map((tool) => ({
        name: tool.name,
        risk: tool.risk ?? "read",
        needs_approval: tool.needsApproval ?? false,
      })),
    },
  };

  const content = [
    "# auth.md",
    "",
    `App: ${contract?.project?.name ?? "unknown"}`,
    "",
    "This file is generated by ForgeOS for agents and authorization-aware clients. It describes protected resource metadata, runtime capabilities, policy names, tenant requirements, and approval expectations without exposing secrets.",
    "",
    "## Protected Resource Metadata",
    "",
    `- Auth mode: \`${auth?.defaultMode ?? "dev-headers"}\` locally; production should use \`jwt\` or \`oidc\`.`,
    `- Bearer header: \`${auth?.bearerTokenHeader ?? "Authorization"}\`.`,
    `- Issuer env: \`${auth?.env?.issuer ?? "FORGE_AUTH_ISSUER"}\`.`,
    `- Audience env: \`${auth?.env?.audience ?? "FORGE_AUTH_AUDIENCE"}\`.`,
    `- JWKS env: \`${auth?.env?.jwksUri ?? "FORGE_AUTH_JWKS_URI"}\`.`,
    `- Tenant required: \`${String(auth?.requiresTenant ?? false)}\`.`,
    "",
    "## OAuth 2.0 Protected Resource Metadata",
    "",
    "```json",
    JSON.stringify(protectedResourceMetadata, null, 2),
    "```",
    "",
    "## Claim Mapping",
    "",
    `- User: \`${auth?.claims?.userId ?? "sub"}\``,
    `- Email: \`${auth?.claims?.email ?? "email"}\``,
    `- Tenant/organization: \`${auth?.claims?.tenantId ?? "tenant_id"}\``,
    `- Role: \`${auth?.claims?.role ?? "role"}\``,
    `- Roles: \`${auth?.claims?.roles ?? "roles"}\``,
    `- Permissions: \`${auth?.claims?.permissions ?? "permissions"}\``,
    "",
    ...listRuntimeEntries("Commands", contract?.commands),
    ...listRuntimeEntries("Queries", contract?.queries),
    ...listRuntimeEntries("Live Queries", contract?.liveQueries),
    ...listRuntimeEntries("Actions", contract?.actions),
    "## Policies",
    "",
    "| Policy | Kind | Roles | Permissions |",
    "|--------|------|-------|-------------|",
    ...(policyRows.length > 0 ? policyRows : ["| none | none | none | none |"]),
    "",
    "## Risk And Approval Metadata",
    "",
    "| Kind | Name | Risk | Needs approval | Policy |",
    "|------|------|------|----------------|--------|",
    ...(riskRows.length > 0
      ? riskRows.map((entry) => `| ${entry.kind} | \`${entry.name}\` | ${entry.risk} | ${String(entry.needs_approval)} | ${entry.policy ? `\`${entry.policy}\`` : "none"} |`)
      : ["| none | none | read | false | none |"]),
    "",
    "## Agent Tools",
    "",
    "| Tool | Description | Risk | Needs approval |",
    "|------|-------------|------|----------------|",
    ...(toolRows.length > 0 ? toolRows : ["| none | none | read | false |"]),
    "",
    "## Verification",
    "",
    "- Run `forge auth check --json` before production.",
    "- Run `forge auth prove --json` before exposing tenant-scoped data.",
    "- Run `forge authmd check --json` before publishing this file.",
    "",
    "## App Docs",
    "",
    "- `/auth.md` should be served as this public authorization summary when the web app has a public directory.",
    "- `src/forge/_generated/agentContract.json` is the private source contract.",
    "- `src/forge/_generated/capabilityMap.json` maps frontend/backend capabilities.",
    "- `src/forge/_generated/policyRegistry.json` is the policy source of truth.",
    ...docLinks.map((path) => `- \`${path}\``),
    "",
  ].join("\n");

  return {
    ok: diagnostics.length === 0,
    path: "public/auth.md",
    metadataPath: "public/.well-known/oauth-protected-resource",
    changed: false,
    diagnostics,
    data: {
      commands: contract?.commands?.length ?? 0,
      queries: contract?.queries?.length ?? 0,
      liveQueries: contract?.liveQueries?.length ?? 0,
      actions: contract?.actions?.length ?? 0,
      policies: contract?.policies?.length ?? 0,
      aiTools: tools?.tools?.length ?? 0,
      requiresTenant: auth?.requiresTenant ?? false,
    },
    content,
    metadataContent: `${JSON.stringify(protectedResourceMetadata, null, 2)}\n`,
    exitCode: diagnostics.length === 0 ? 0 : 1,
  };
}

export function runAuthMdCommand(options: AuthMdCommandOptions): AuthMdCommandResult {
  const rendered = renderAuthMd(options.workspaceRoot);
  const path = outputPath(options);
  const metadataPath = metadataPathFor(path);
  const absolute = join(options.workspaceRoot, path);
  const metadataAbsolute = join(options.workspaceRoot, metadataPath);
  const current = nodeFileSystem.exists(absolute) ? readFileSync(absolute, "utf8") : null;
  const currentMetadata = nodeFileSystem.exists(metadataAbsolute) ? readFileSync(metadataAbsolute, "utf8") : null;
  const changed = current !== rendered.content || currentMetadata !== rendered.metadataContent;
  const result = {
    ...rendered,
    path,
    metadataPath,
    changed,
    exitCode: rendered.exitCode,
  };
  delete (result as { content?: string }).content;
  delete (result as { metadataContent?: string }).metadataContent;

  if (rendered.exitCode !== 0) {
    return result;
  }

  if (options.subcommand === "check") {
    return {
      ...result,
      ok: !changed,
      diagnostics: changed
        ? [
            {
              code: "FORGE_AUTHMD_DRIFT",
              message: `${path} is missing or stale; run forge authmd generate`,
            },
          ]
        : [],
      exitCode: changed ? 1 : 0,
    };
  }

  mkdirSync(dirname(absolute), { recursive: true });
  mkdirSync(dirname(metadataAbsolute), { recursive: true });
  writeFileSync(absolute, rendered.content, "utf8");
  writeFileSync(metadataAbsolute, rendered.metadataContent, "utf8");
  return {
    ...result,
    ok: true,
    changed,
    exitCode: 0,
  };
}

export function formatAuthMdJson(result: AuthMdCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAuthMdHuman(result: AuthMdCommandResult): string {
  const status = result.ok ? "ok" : "failed";
  const drift = result.changed ? "changed" : "unchanged";
  const diagnostics = result.diagnostics.map((item) => `${item.code}: ${item.message}`).join("\n");
  return `auth.md ${status}: ${result.path} (${drift})\n${diagnostics ? `${diagnostics}\n` : ""}`;
}
