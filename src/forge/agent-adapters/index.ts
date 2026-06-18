import { nodeFileSystem } from "../compiler/fs/index.ts";
import { dirname, join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR, GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { serializeCanonical } from "../compiler/primitives/serialize.ts";
import { secretLeakScan } from "../compiler/sandbox/secret-scan.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { AgentContract } from "../compiler/agent-contract/types.ts";
import {
  FORGE_AGENT_ADAPTER_INVALID,
  FORGE_AGENT_EXPORT_FAILED,
  FORGE_AGENT_MARKERS_MISSING,
  FORGE_AGENT_SECRET_LEAK,
  FORGE_AGENT_STALE_EXPORT,
  FORGE_AGENT_TARGET_UNKNOWN,
  FORGE_AGENT_TEMPLATE_RENDER_FAILED,
} from "../compiler/diagnostics/codes.ts";
import type {
  AgentAdapterManifest,
  AgentAdapterTarget,
  AgentCommandOptions,
  AgentCommandsMap,
  AgentContext,
  AgentDoneCriteria,
  AgentDoctorResult,
  AgentExportFile,
  AgentExportResult,
  AgentPrintContextResult,
  AgentTargetsResult,
  CustomAdapterConfig,
  AgentCheckResult,
} from "./types.ts";
import {
  formatAgentMemoryHuman,
  formatAgentMemoryJson,
  runAgentMemoryCommand,
  type AgentMemoryCommandResult,
} from "../agent-memory/bridge.ts";

export const AGENT_ADAPTER_VERSION = "agent-adapter-0.1.0";
export const AGENT_FORMAT_VERSION = "2026-06";

const USER_START = "<!-- user-notes:start -->";
const USER_END = "<!-- user-notes:end -->";
const GENERATED_START = "<!-- forge-generated:start -->";
const GENERATED_END = "<!-- forge-generated:end -->";
const CUSTOM_ADAPTERS_DIR = ".forge/agent-adapters";

function sorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
): Diagnostic {
  return createDiagnostic({ severity, code, message, ...(file ? { file } : {}) });
}

function readText(workspaceRoot: string, relative: string): string | null {
  const path = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  return stripDeterministicHeader((nodeFileSystem.readText(path) ?? ""));
}

function readJson<T>(workspaceRoot: string, relative: string): T | null {
  const text = readText(workspaceRoot, relative);
  if (text === null) {
    return null;
  }
  return JSON.parse(text) as T;
}

function writeText(workspaceRoot: string, relative: string, content: string): void {
  const path = join(workspaceRoot, relative);
  nodeFileSystem.mkdirp(dirname(path));
  nodeFileSystem.writeText(path, content);
}

function renderJson(value: unknown): string {
  return serializeCanonical(value);
}

function tsExport(name: string, value: unknown): string {
  const parsed = JSON.parse(renderJson(value).trimEnd()) as unknown;
  return `export const ${name} = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

function sourceHash(contract: AgentContract): string {
  return `sha256:${hashStable(renderJson(contract))}`;
}

export function buildAgentAdapterManifest(contract: AgentContract): AgentAdapterManifest {
  const genericFiles = buildGenericFiles(contract).map((file) => file.path);
  return {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    sourceHash: sourceHash(contract),
    targets: [
      {
        name: "generic",
        default: true,
        adapterVersion: AGENT_ADAPTER_VERSION,
        formatVersion: AGENT_FORMAT_VERSION,
        files: genericFiles,
      },
      {
        name: "codex",
        optional: true,
        adapterVersion: AGENT_ADAPTER_VERSION,
        formatVersion: AGENT_FORMAT_VERSION,
        files: buildCodexFiles(contract, { skills: true }).map((file) => file.path),
      },
      {
        name: "cursor",
        optional: true,
        adapterVersion: AGENT_ADAPTER_VERSION,
        formatVersion: AGENT_FORMAT_VERSION,
        files: buildCursorFiles(contract, { rules: true }).map((file) => file.path),
      },
      {
        name: "claude",
        optional: true,
        adapterVersion: AGENT_ADAPTER_VERSION,
        formatVersion: AGENT_FORMAT_VERSION,
        files: buildClaudeFiles(contract).map((file) => file.path),
      },
    ],
  };
}

export function serializeAgentAdapterManifestJson(manifest: AgentAdapterManifest): string {
  return renderJson(manifest);
}

export function serializeAgentAdapterManifestTs(manifest: AgentAdapterManifest): string {
  return tsExport("agentAdapterManifest", manifest);
}

export function buildAgentContext(contract: AgentContract): AgentContext {
  return {
    schemaVersion: "0.1.0",
    project: {
      name: contract.project.name,
      framework: "forgeos",
      ...(contract.project.template ? { template: contract.project.template } : {}),
    },
    runtimeModel: {
      command: "transactional write, no network/secrets/AI",
      query: "read-only, tenant-scoped",
      liveQuery: "read-only reactive query",
      action: "side effects after commit",
      workflow: "durable steps after outbox event",
    },
    commands: sorted(contract.commands.map((entry) => entry.name)),
    queries: sorted(contract.queries.map((entry) => entry.name)),
    liveQueries: sorted(contract.liveQueries.map((entry) => entry.name)),
    actions: sorted(contract.actions.map((entry) => entry.name)),
    workflows: sorted(contract.workflows.map((entry) => entry.name)),
    tables: sorted(contract.data.tables.map((entry) => entry.name)),
    policies: sorted(contract.policies.map((entry) => entry.name)),
    secrets: sorted(contract.secrets.map((entry) => entry.name)),
    criticalCommands: {
      afterSourceChange: ["forge generate", "forge check"],
      beforeCommit: ["forge verify --strict"],
      targetedLoop: [
        "forge impact --changed --json",
        "forge test plan --changed --json",
        "forge test run --changed --json",
      ],
      repair: ["forge repair diagnose --from-last-test-run --json"],
    },
    knownPitfalls: [
      "Do not edit src/forge/_generated/** directly.",
      "Do not use process.env directly in app code.",
      "Do not import network packages in command/query/liveQuery.",
      "Preserve tenant isolation and policy declarations.",
      "Use forge make, forge feature, forge refactor, forge impact, and forge repair before hand-editing architecture.",
    ],
  };
}

export function buildAgentCommandsMap(): AgentCommandsMap {
  return {
    setup: ["bun install"],
    dev: ["forge dev"],
    generate: ["forge generate"],
    check: ["forge check"],
    verify: ["forge verify --strict"],
    impact: ["forge impact --changed --json"],
    testPlan: ["forge test plan --changed --json"],
    testRun: ["forge test run --changed --json"],
    repair: ["forge repair diagnose --from-last-test-run --json"],
  };
}

export function buildAgentDoneCriteria(): AgentDoneCriteria {
  return {
    default: [
      "forge generate --check passes",
      "forge check passes",
      "forge verify --strict passes",
      "no edits under src/forge/_generated",
      "no direct process.env in app code",
      "no forbidden runtime imports",
    ],
    frontendChange: [
      "affected React tests pass",
      "client entrypoints remain client-safe",
      "liveQuery smoke passes if live data changed",
    ],
    schemaChange: [
      "forge db diff reviewed",
      "RLS check passes for tenant-scoped tables",
      "affected queries/liveQueries tested",
    ],
    packageChange: [
      "forge deps upgrade-plan reviewed",
      "runtimeMatrix unchanged or expected",
      "affected integration tests pass",
    ],
  };
}

function replaceGeneratedBlock(existing: string | null, generated: string, fallbackUserNotes: string): string {
  const userBlock = extractUserBlock(existing) ?? `${USER_START}\n\n${fallbackUserNotes}\n\n${USER_END}`;
  return `${GENERATED_START}\n${generated.trim()}\n${GENERATED_END}\n\n${userBlock.trim()}\n`;
}

function extractUserBlock(existing: string | null): string | null {
  if (!existing) {
    return null;
  }
  const start = existing.indexOf(USER_START);
  const end = existing.indexOf(USER_END);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }
  return existing.slice(start, end + USER_END.length);
}

function agentsMarkdown(contract: AgentContract, existing: string | null): string {
  const context = buildAgentContext(contract);
  const generated = `# AGENTS.md

## Project Type

This is a ForgeOS application.

## Required Workflow

Before editing:

\`\`\`bash
forge inspect all --json
forge doctor --json
\`\`\`

During editing:

\`\`\`bash
forge impact --changed --json
forge test plan --changed --json
\`\`\`

After editing:

\`\`\`bash
forge generate
forge check
forge verify --strict
\`\`\`

## Do Not

- Do not edit \`src/forge/_generated/**\`.
- Do not import network packages in \`command\`, \`query\`, or \`liveQuery\`.
- Do not use \`process.env\` directly in app code.
- Use \`ctx.secrets\`.
- Do not bypass tenant isolation.
- Do not call \`ctx.ai\` in \`command\`, \`query\`, or \`liveQuery\`.
- Do not manually modify \`forge.lock\` unless instructed.

## Runtime Model

- \`command\`: ${context.runtimeModel.command}.
- \`query\`: ${context.runtimeModel.query}.
- \`liveQuery\`: ${context.runtimeModel.liveQuery}.
- \`action\`: ${context.runtimeModel.action}.
- \`workflow\`: ${context.runtimeModel.workflow}.

## Common Commands

\`\`\`bash
forge make resource <name>
forge feature plan <blueprint>
forge refactor rename field <from> <to>
forge impact --changed --json
forge repair diagnose --from-last-test-run --json
forge agent print-context --json
\`\`\`

## Agent Adapter Exports

- Generic agents read \`.forge/agent/context.json\` and \`.forge/agent/playbooks/*.md\`.
- Codex skills are generated under \`.codex/skills/**\`.
- Cursor rules are generated under \`.cursor/rules/**\`.
- Claude instructions are generated in \`CLAUDE.md\` and \`.claude/**\`.

These files are derived from ForgeOS generated contracts. Regenerate them with:

\`\`\`bash
forge agent export --target all
\`\`\``;
  return `# AGENTS.md\n\n${replaceGeneratedBlock(existing, generated, "Project-specific human notes go here.")}`;
}

function playbook(title: string, steps: string[]): string {
  return `# Playbook: ${title}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n`;
}

function playbookFiles(): AgentExportFile[] {
  const books: Array<[string, string, string[]]> = [
    ["add-command.md", "Add Command", [
      "Run `forge inspect all --json`.",
      "Prefer `forge make command <resource.action> --table <table> --policy <policy>`.",
      "Commands may write through `ctx.db` and emit with `ctx.emit`.",
      "Commands must not import network packages, use `ctx.secrets`, or call `ctx.ai`.",
      "Run `forge generate`, `forge check`, and `forge verify --changed`.",
      "Finish with `forge verify --strict`.",
    ]],
    ["add-query.md", "Add Query", [
      "Run `forge inspect data --json` and `forge inspect policies --json`.",
      "Prefer `forge make query <name> --table <table> --policy <policy>`.",
      "Keep queries read-only and tenant-scoped.",
      "Run `forge generate` and `forge check`.",
    ]],
    ["add-livequery.md", "Add LiveQuery", [
      "Prefer `forge make livequery <name> --table <table> --policy <policy>`.",
      "Keep liveQueries read-only and reactive.",
      "Run `forge live status --json` when debugging subscriptions.",
      "Run `forge verify --changed`.",
    ]],
    ["add-resource.md", "Add Resource", [
      "Run `forge make resource <name> --fields name:string --dry-run --json`.",
      "Review planned schema, policies, commands, queries, and components.",
      "Apply with `forge make resource <name> --fields ... --yes`.",
      "Run `forge generate` and `forge verify --strict`.",
    ]],
    ["refactor-field.md", "Refactor Field", [
      "Use `forge refactor rename field <from> <to> --plan` before manual edits.",
      "Inspect the plan and public API risk.",
      "Apply with `forge refactor apply <planId> --yes`.",
      "Run `forge impact --changed --json` and targeted tests.",
    ]],
    ["fix-policy-denied.md", "Fix Policy Denied", [
      "Run `forge repair diagnose --from-last-test-run --json`.",
      "Run `forge policy simulate <policy> --role <role>`.",
      "Prefer policy changes through `forge make policy`.",
      "Run `forge verify --strict` after changing access rules.",
    ]],
    ["fix-guard-violation.md", "Fix FORGE_GUARD_VIOLATION", [
      "Run `forge repair diagnose --from-last-test-run --json`.",
      "If a network package is reachable from command/query/liveQuery, prefer `forge refactor extract-action <command> --package <package> --event <event>`.",
      "Run `forge generate`, `forge check`, and `forge verify --changed`.",
      "Finish with `forge verify --strict`.",
    ]],
    ["upgrade-package.md", "Upgrade Package", [
      "Run `forge deps upgrade-plan <package> --to latest --json`.",
      "Review runtime context, secret, and API risk.",
      "Apply only after reviewing the plan.",
      "Run impacted tests and `forge verify --strict`.",
    ]],
    ["debug-trace.md", "Debug Trace", [
      "Capture the `traceId` from frontend or runtime output.",
      "Run `forge telemetry inspect <traceId>`.",
      "Run `forge repair diagnose --trace <traceId> --json`.",
      "Prefer targeted repairs and impacted tests before full verify.",
    ]],
    ["frontend-change.md", "Frontend Change", [
      "Use generated client APIs and React hooks.",
      "Do not import server adapters or server-only packages into client code.",
      "Preserve `ForgeError.traceId` in visible error states.",
      "Run affected frontend tests and `forge verify --changed`.",
    ]],
    ["self-host-check.md", "Self-host Check", [
      "Run `forge self-host check`.",
      "Run `forge release artifacts verify` when deployment artifacts changed.",
      "Run `forge verify --strict` before handoff.",
    ]],
  ];
  return books.map(([name, title, steps]) => ({
    path: `.forge/agent/playbooks/${name}`,
    content: playbook(title, steps),
  }));
}

function buildGenericFiles(contract: AgentContract, existingAgentsMd?: string | null): AgentExportFile[] {
  return [
    { path: "AGENTS.md", content: existingAgentsMd ?? agentsMarkdown(contract, null) },
    { path: ".forge/agent/context.json", content: renderJson(buildAgentContext(contract)) },
    { path: ".forge/agent/commands.json", content: renderJson(buildAgentCommandsMap()) },
    { path: ".forge/agent/done-criteria.json", content: renderJson(buildAgentDoneCriteria()) },
    ...playbookFiles(),
  ];
}

function skill(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${description}\n\n${body.trim()}\n`;
}

function buildCodexFiles(_contract: AgentContract, options: { skills: boolean }): AgentExportFile[] {
  if (!options.skills) {
    return [];
  }
  const skills: Array<[string, string, string]> = [
    ["forge-add-command", "Use when adding or modifying a ForgeOS command.", `
Rules:
- Commands require \`auth: can("...")\`.
- Commands may write through \`ctx.db\`.
- Commands may call \`ctx.emit\`.
- Commands must not import network packages.
- Commands must not use \`ctx.secrets\` or \`ctx.ai\`.

Steps:
1. Run \`forge inspect all --json\`.
2. Prefer \`forge make command <resource.action> --table <table> --policy <policy>\`.
3. Run \`forge generate\`, \`forge check\`, and \`forge verify --changed\`.
4. Finish with \`forge verify --strict\`.
`],
    ["forge-add-resource", "Use when adding a ForgeOS resource.", `
Use \`forge make resource <name> --fields ... --dry-run --json\` first.
Review generated table, policy, command, query, liveQuery, component, and page changes.
Apply with \`--yes\`, then run \`forge generate\` and \`forge verify --strict\`.
`],
    ["forge-fix-guard-violation", "Use when ForgeOS reports FORGE_GUARD_VIOLATION.", `
Run \`forge repair diagnose --from-last-test-run --json\`.
If a network package is reachable from command/query/liveQuery, prefer:
\`forge refactor extract-action <command> --package <package> --event <event>\`.
`],
    ["forge-fix-policy-denied", "Use when ForgeOS reports a policy or auth denial.", `
Run \`forge repair diagnose --from-last-test-run --json\` and \`forge policy simulate <policy> --role <role>\`.
Prefer changing policies through \`forge make policy\`.
`],
    ["forge-upgrade-package", "Use when upgrading a package in a ForgeOS app.", `
Run \`forge deps upgrade-plan <package> --to latest --json\`.
Review runtime, secret, and API risks before applying.
Run impacted tests and \`forge verify --strict\`.
`],
    ["forge-debug-trace", "Use when debugging a ForgeOS trace or failing runtime operation.", `
Run \`forge telemetry inspect <traceId>\`.
Then run \`forge repair diagnose --trace <traceId> --json\`.
Prefer targeted checks before full verification.
`],
  ];
  const files = skills.map(([name, description, body]) => ({
    path: `.codex/skills/${name}/SKILL.md`,
    content: skill(name, description, body),
  }));
  const agents = ["explorer", "worker", "reviewer", "security"].map((name) => ({
    path: `.codex/agents/forge-${name}.toml`,
    content: `name = "forge-${name}"\ndescription = "ForgeOS ${name} helper generated from agentAdapterManifest."\n`,
  }));
  return [...files, ...agents];
}

function mdc(description: string, globs: string[], body: string): string {
  return `---\ndescription: ${description}\nglobs:\n${globs.map((glob) => `  - "${glob}"`).join("\n")}\nalwaysApply: true\n---\n\n${body.trim()}\n`;
}

function buildCursorFiles(_contract: AgentContract, options: { rules: boolean }): AgentExportFile[] {
  if (!options.rules) {
    return [];
  }
  return [
    {
      path: ".cursor/rules/forge-runtime.mdc",
      content: mdc(
        "ForgeOS runtime rules for commands, queries, liveQueries, actions and workflows.",
        ["src/**/*.ts", "src/**/*.tsx"],
        `# ForgeOS Runtime Rules

- Do not edit \`src/forge/_generated/**\`.
- Commands are transactional writes.
- Queries and liveQueries are read-only.
- Commands must not import network packages.
- Commands must not use \`ctx.secrets\` or \`ctx.ai\`.
- Use \`ctx.emit\` for side effects.
- Use actions/workflows for external APIs.
- Run \`forge check\` after changing runtime code.`,
      ),
    },
    {
      path: ".cursor/rules/forge-frontend.mdc",
      content: mdc(
        "ForgeOS frontend/client rules.",
        ["web/**/*.tsx", "web/**/*.ts", "src/**/*.tsx"],
        `# ForgeOS Frontend Rules

- Import generated API and hooks.
- Do not import server adapters or server-only packages.
- Use \`useLiveQuery\`, \`useQuery\`, and \`useCommand\`.
- Preserve \`ForgeError.traceId\` in user-visible error states.`,
      ),
    },
    {
      path: ".cursor/rules/forge-security.mdc",
      content: mdc(
        "ForgeOS tenant, policy, and secret safety rules.",
        ["src/**/*.ts", "web/**/*.ts", "web/**/*.tsx"],
        `# ForgeOS Security Rules

- Never include secret values in generated files, logs, or adapter exports.
- Use \`ctx.secrets\`; do not read \`process.env\` directly in app code.
- Preserve tenant-scoped reads and writes.
- Run \`forge policy check --strict-policies\` after access changes.`,
      ),
    },
    {
      path: ".cursor/rules/forge-workflow.mdc",
      content: mdc(
        "ForgeOS workflow, impact, repair, and verification workflow.",
        ["src/**/*.ts", "tests/**/*.ts"],
        `# ForgeOS Workflow

- Prefer \`forge make\` for new primitives.
- Prefer \`forge feature\` for blueprint-driven changes.
- Prefer \`forge refactor\` for renames, moves, and side-effect extraction.
- Run \`forge impact --changed --json\` and \`forge test plan --changed --json\`.
- Use \`forge repair diagnose --from-last-test-run --json\` after failures.`,
      ),
    },
  ];
}

function buildClaudeFiles(_contract: AgentContract): AgentExportFile[] {
  const claude = `# CLAUDE.md

This is a ForgeOS app.

Start with:

\`\`\`bash
forge inspect all --json
forge doctor --json
\`\`\`

After changes:

\`\`\`bash
forge generate
forge verify --strict
\`\`\`

Critical rules:

- Do not edit \`src/forge/_generated/**\`.
- Commands cannot use network packages, secrets, or AI.
- Queries/liveQueries are read-only.
- Use \`ctx.emit\` for side effects.
- Use \`ctx.secrets\`, never \`process.env\`.
`;
  return [
    { path: "CLAUDE.md", content: claude },
    { path: ".claude/forge-runtime.md", content: readmeRuntime() },
    { path: ".claude/forge-playbooks.md", content: playbookFiles().map((file) => file.content).join("\n") },
    { path: ".claude/forge-security.md", content: "# ForgeOS Security\n\nNever include secret values. Preserve policies, tenant scopes, and generated runtime rules.\n" },
  ];
}

function readmeRuntime(): string {
  return `# ForgeOS Runtime

- Commands are transactional writes and emit events for side effects.
- Queries and liveQueries are read-only.
- Actions and workflows perform side effects after commit.
- AI is allowed in actions/workflows/endpoints/server, not commands/queries/liveQueries.
`;
}

function loadCustomAdapter(workspaceRoot: string, target: string): CustomAdapterConfig | null {
  return readJson<CustomAdapterConfig>(workspaceRoot, `${CUSTOM_ADAPTERS_DIR}/${target}/adapter.json`);
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (typeof current === "object" && current !== null && part in current) {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, value);
}

function renderTemplate(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression: string) => {
    const trimmed = expression.trim();
    if (trimmed.startsWith("json ")) {
      const value = getPath(context, trimmed.slice(5).trim());
      return JSON.stringify(value, null, 2);
    }
    const value = getPath(context, trimmed);
    if (value === undefined || value === null) {
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}

function buildCustomFiles(workspaceRoot: string, target: string, contract: AgentContract): { files: AgentExportFile[]; diagnostics: Diagnostic[] } {
  const config = loadCustomAdapter(workspaceRoot, target);
  if (!config) {
    return {
      files: [],
      diagnostics: [
        diagnostic(
          "error",
          FORGE_AGENT_TARGET_UNKNOWN,
          `unknown agent adapter target: ${target}`,
        ),
      ],
    };
  }
  if (!Array.isArray(config.outputs)) {
    return {
      files: [],
      diagnostics: [
        diagnostic(
          "error",
          FORGE_AGENT_ADAPTER_INVALID,
          `invalid custom adapter config: ${CUSTOM_ADAPTERS_DIR}/${target}/adapter.json`,
        ),
      ],
    };
  }
  const context = {
    agentContract: contract,
    context: buildAgentContext(contract),
    commands: buildAgentCommandsMap(),
    project: contract.project,
  };
  const files: AgentExportFile[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const output of config.outputs) {
    const templatePath = `${CUSTOM_ADAPTERS_DIR}/${target}/templates/${output.template}`;
    const template = readText(workspaceRoot, templatePath);
    if (template === null) {
      diagnostics.push(
        diagnostic(
          "error",
          FORGE_AGENT_TEMPLATE_RENDER_FAILED,
          `custom adapter template not found: ${templatePath}`,
          templatePath,
        ),
      );
      continue;
    }
    files.push({
      path: output.path,
      content: renderTemplate(template, context),
    });
  }
  return { files, diagnostics };
}

function builtFilesForTarget(
  workspaceRoot: string,
  contract: AgentContract,
  target: AgentAdapterTarget,
  options: Pick<AgentCommandOptions, "skills" | "rules">,
): { files: AgentExportFile[]; diagnostics: Diagnostic[] } {
  const existingAgentsMd = readText(workspaceRoot, "AGENTS.md");
  if (target === "generic") {
    return { files: buildGenericFiles(contract, existingAgentsMd), diagnostics: [] };
  }
  if (target === "codex") {
    return { files: [...buildGenericFiles(contract, existingAgentsMd), ...buildCodexFiles(contract, { skills: options.skills })], diagnostics: [] };
  }
  if (target === "cursor") {
    return { files: [...buildGenericFiles(contract, existingAgentsMd), ...buildCursorFiles(contract, { rules: options.rules })], diagnostics: [] };
  }
  if (target === "claude") {
    return { files: [...buildGenericFiles(contract, existingAgentsMd), ...buildClaudeFiles(contract)], diagnostics: [] };
  }
  if (target === "all") {
    const byPath = new Map<string, AgentExportFile>();
    for (const file of [
      ...buildGenericFiles(contract, existingAgentsMd),
      ...buildCodexFiles(contract, { skills: options.skills }),
      ...buildCursorFiles(contract, { rules: options.rules }),
      ...buildClaudeFiles(contract),
    ]) {
      byPath.set(file.path, file);
    }
    return { files: [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)), diagnostics: [] };
  }
  return buildCustomFiles(workspaceRoot, target, contract);
}

function validateFiles(files: AgentExportFile[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scan = secretLeakScan(file.content, { includeHighEntropy: false });
    if (scan.hasLeak) {
      diagnostics.push(
        diagnostic(
          "error",
          FORGE_AGENT_SECRET_LEAK,
          `agent adapter output may contain a secret: ${scan.matches.join(", ")}`,
          file.path,
        ),
      );
    }
  }
  return diagnostics;
}

function loadContract(workspaceRoot: string): { contract: AgentContract | null; diagnostics: Diagnostic[] } {
  const contract = readJson<AgentContract>(workspaceRoot, `${GENERATED_DIR}/agentContract.json`);
  if (!contract) {
    return {
      contract: null,
      diagnostics: [
        diagnostic(
          "error",
          FORGE_AGENT_EXPORT_FAILED,
          `missing ${GENERATED_DIR}/agentContract.json; run forge generate first`,
          `${GENERATED_DIR}/agentContract.json`,
        ),
      ],
    };
  }
  return { contract, diagnostics: [] };
}

export function runAgentExport(options: AgentCommandOptions): AgentExportResult {
  const { contract, diagnostics } = loadContract(options.workspaceRoot);
  if (!contract) {
    return {
      ok: false,
      target: options.target,
      filesWritten: [],
      filesPlanned: [],
      warnings: [],
      diagnostics,
      exitCode: 1,
    };
  }
  const built = builtFilesForTarget(options.workspaceRoot, contract, options.target, options);
  const validation = validateFiles(built.files);
  const allDiagnostics = [...built.diagnostics, ...validation];
  if (allDiagnostics.some((diag) => diag.severity === "error")) {
    return {
      ok: false,
      target: options.target,
      filesWritten: [],
      filesPlanned: built.files.map((file) => file.path),
      warnings: allDiagnostics.filter((diag) => diag.severity === "warning"),
      diagnostics: allDiagnostics,
      exitCode: 1,
    };
  }
  if (options.dryRun) {
    return {
      ok: true,
      target: options.target,
      filesWritten: [],
      filesPlanned: built.files.map((file) => file.path),
      warnings: [],
      diagnostics: [],
      exitCode: 0,
    };
  }
  const filesWritten: string[] = [];
  for (const file of built.files) {
    const existing = readText(options.workspaceRoot, file.path);
    if (
      options.preserveUserSections &&
      existing &&
      file.path.endsWith(".md") &&
      existing.includes(USER_START) !== existing.includes(USER_END)
    ) {
      return {
        ok: false,
        target: options.target,
        filesWritten,
        filesPlanned: built.files.map((candidate) => candidate.path),
        warnings: [],
        diagnostics: [
          diagnostic(
            "error",
            FORGE_AGENT_MARKERS_MISSING,
            `malformed user section markers in ${file.path}`,
            file.path,
          ),
        ],
        exitCode: 1,
      };
    }
    if (existing !== file.content || options.force) {
      writeText(options.workspaceRoot, file.path, file.content);
      filesWritten.push(file.path);
    }
  }
  return {
    ok: true,
    target: options.target,
    filesWritten,
    filesPlanned: built.files.map((file) => file.path),
    warnings: [],
    diagnostics: [],
    exitCode: 0,
  };
}

export function runAgentCheck(options: AgentCommandOptions): AgentCheckResult {
  const { contract, diagnostics } = loadContract(options.workspaceRoot);
  if (!contract) {
    return { ok: false, stale: [], missing: [], warnings: [], diagnostics, exitCode: 1 };
  }
  const built = builtFilesForTarget(options.workspaceRoot, contract, options.target, options);
  const validation = validateFiles(built.files);
  const stale: string[] = [];
  const missing: string[] = [];
  for (const file of built.files) {
    const existing = readText(options.workspaceRoot, file.path);
    if (existing === null) {
      missing.push(file.path);
    } else if (existing !== file.content) {
      stale.push(file.path);
    }
  }
  const diag = [...built.diagnostics, ...validation];
  for (const file of stale) {
    diag.push(diagnostic("error", FORGE_AGENT_STALE_EXPORT, `stale agent adapter export: ${file}`, file));
  }
  for (const file of missing) {
    diag.push(diagnostic("error", FORGE_AGENT_STALE_EXPORT, `missing agent adapter export: ${file}`, file));
  }
  const ok = stale.length === 0 && missing.length === 0 && diag.every((item) => item.severity !== "error");
  return {
    ok,
    stale,
    missing,
    warnings: diag.filter((item) => item.severity === "warning"),
    diagnostics: diag,
    exitCode: ok ? 0 : 1,
  };
}

export function runAgentPrintContext(workspaceRoot: string): AgentPrintContextResult {
  const { contract, diagnostics } = loadContract(workspaceRoot);
  if (!contract) {
    return { context: null, diagnostics, exitCode: 1 };
  }
  return { context: buildAgentContext(contract), diagnostics: [], exitCode: 0 };
}

export function listCustomTargets(workspaceRoot: string): string[] {
  const dir = join(workspaceRoot, CUSTOM_ADAPTERS_DIR);
  if (!nodeFileSystem.exists(dir)) {
    return [];
  }
  return nodeFileSystem
    .readDir(dir)
    .map((entry) => entry.name)
    .filter((entry) => nodeFileSystem.exists(join(dir, entry, "adapter.json")))
    .sort();
}

export function runAgentListTargets(workspaceRoot: string): AgentTargetsResult {
  return {
    targets: [
      { name: "generic", default: true },
      { name: "codex", optional: true },
      { name: "cursor", optional: true },
      { name: "claude", optional: true },
      ...listCustomTargets(workspaceRoot).map((name) => ({ name, custom: true })),
    ],
    exitCode: 0,
  };
}

function targetFiles(target: AgentAdapterTarget): string[] {
  if (target === "generic") {
    return [".forge/agent"];
  }
  if (target === "codex") {
    return [".codex"];
  }
  if (target === "cursor") {
    return [".cursor"];
  }
  if (target === "claude") {
    return ["CLAUDE.md", ".claude"];
  }
  if (target === "all") {
    return [".forge/agent", ".codex", ".cursor", "CLAUDE.md", ".claude"];
  }
  return [];
}

export function runAgentClean(options: AgentCommandOptions): AgentExportResult {
  const planned = targetFiles(options.target);
  if (planned.length === 0) {
    return {
      ok: false,
      target: options.target,
      filesWritten: [],
      filesPlanned: [],
      warnings: [],
      diagnostics: [
        diagnostic("error", FORGE_AGENT_TARGET_UNKNOWN, `unknown clean target: ${options.target}`),
      ],
      exitCode: 1,
    };
  }
  if (!options.dryRun) {
    for (const relative of planned) {
      nodeFileSystem.remove(join(options.workspaceRoot, relative));
    }
  }
  return {
    ok: true,
    target: options.target,
    filesWritten: options.dryRun ? [] : planned,
    filesPlanned: planned,
    warnings: [],
    diagnostics: [],
    exitCode: 0,
  };
}

export function runAgentDoctor(options: AgentCommandOptions): AgentDoctorResult {
  const check = runAgentCheck(options);
  const checks = [
    { name: "AGENTS.md", ok: !check.missing.includes("AGENTS.md") },
    { name: "agent-context", ok: !check.missing.includes(".forge/agent/context.json") },
    { name: "commands", ok: !check.missing.includes(".forge/agent/commands.json") },
    { name: "done-criteria", ok: !check.missing.includes(".forge/agent/done-criteria.json") },
    { name: "stale-exports", ok: check.stale.length === 0, message: check.stale.join(", ") || undefined },
    { name: "secret-scan", ok: !check.diagnostics.some((diag) => diag.code === FORGE_AGENT_SECRET_LEAK) },
  ];
  const ok = checks.every((item) => item.ok) && check.exitCode === 0;
  return { ok, checks, diagnostics: check.diagnostics, exitCode: ok ? 0 : 1 };
}

export async function runAgentCommand(options: AgentCommandOptions): Promise<
  AgentExportResult | AgentCheckResult | AgentTargetsResult | AgentPrintContextResult | AgentDoctorResult | AgentMemoryCommandResult
> {
  if (options.subcommand === "list-targets") {
    return runAgentListTargets(options.workspaceRoot);
  }
  if (options.subcommand === "export") {
    return runAgentExport(options);
  }
  if (options.subcommand === "check") {
    return runAgentCheck({ ...options, target: options.target || "generic" });
  }
  if (options.subcommand === "doctor") {
    return runAgentDoctor({ ...options, target: options.target || "generic" });
  }
  if (options.subcommand === "print-context") {
    return runAgentPrintContext(options.workspaceRoot);
  }
  if (options.subcommand === "clean") {
    return runAgentClean(options);
  }
  if (
    options.subcommand === "install" ||
    options.subcommand === "ingest" ||
    options.subcommand === "context" ||
    options.subcommand === "memory"
  ) {
    return runAgentMemoryCommand({
      subcommand: options.subcommand,
      workspaceRoot: options.workspaceRoot,
      json: options.json,
      target: options.target,
      source: options.target,
      eventName: options.eventName,
      input: options.input,
      entry: options.entry,
      current: options.current,
      dryRun: options.dryRun,
      force: options.force,
      limit: options.limit,
    });
  }
  return {
    ok: false,
    target: options.target,
    filesWritten: [],
    filesPlanned: [],
    warnings: [],
    diagnostics: [
      diagnostic("error", FORGE_AGENT_EXPORT_FAILED, `unknown forge agent subcommand: ${options.subcommand}`),
    ],
    exitCode: 1,
  };
}

export function formatAgentJson(result: Awaited<ReturnType<typeof runAgentCommand>>): string {
  if ("privacy" in result || "event" in result || "agentMemory" in result || "events" in result) {
    return formatAgentMemoryJson(result as AgentMemoryCommandResult);
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAgentHuman(result: Awaited<ReturnType<typeof runAgentCommand>>): string {
  if ("privacy" in result || "event" in result || "agentMemory" in result || "events" in result) {
    return formatAgentMemoryHuman(result as AgentMemoryCommandResult);
  }
  if ("targets" in result) {
    return `${result.targets.map((target) => `${target.name}${target.default ? " (default)" : ""}${target.optional ? " (optional)" : ""}${target.custom ? " (custom)" : ""}`).join("\n")}\n`;
  }
  if ("context" in result) {
    return `${JSON.stringify(result.context, null, 2)}\n`;
  }
  if ("checks" in result) {
    return `Forge Agent Doctor\n\n${result.checks.map((check) => `${check.ok ? "OK" : "WARN"} ${check.name}${check.message ? `: ${check.message}` : ""}`).join("\n")}\n`;
  }
  if ("stale" in result) {
    if (result.ok) {
      return "agent adapter exports are current\n";
    }
    return `agent adapter exports are stale\nmissing: ${result.missing.join(", ") || "none"}\nstale: ${result.stale.join(", ") || "none"}\n`;
  }
  const exportResult = result as AgentExportResult;
  return `agent export ${exportResult.ok ? "ok" : "failed"} for ${exportResult.target}\nfiles written:\n${exportResult.filesWritten.map((file: string) => `- ${file}`).join("\n") || "- none"}\n`;
}
