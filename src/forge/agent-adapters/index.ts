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
  AgentHooksSmokeResult,
  AgentHooksStatusResult,
  AgentOnboardResult,
  AgentPrintContextResult,
  AgentPrepareResult,
  AgentTimelineItem,
  AgentTimelineResult,
  AgentTargetsResult,
  CustomAdapterConfig,
  AgentCheckResult,
} from "./types.ts";
import type { AgentMemoryEventRecord } from "../agent-memory/types.ts";
import {
  formatAgentMemoryHuman,
  formatAgentMemoryJson,
  runAgentMemoryCommand,
  type AgentMemoryCommandResult,
} from "../agent-memory/bridge.ts";
import { runDevConsoleCycle } from "../dev-console/cycle.ts";

export const AGENT_ADAPTER_VERSION = "agent-adapter-0.1.0";
export const AGENT_FORMAT_VERSION = "2026-06";

const USER_START = "<!-- user-notes:start -->";
const USER_END = "<!-- user-notes:end -->";
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

function playbook(title: string, steps: string[]): string {
  return `# Playbook: ${title}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n`;
}

function playbookFiles(): AgentExportFile[] {
  const books: Array<[string, string, string[]]> = [
    ["add-command.md", "Add Command", [
      "Run `forge status --json`, `forge handoff --json`, and `forge agent print-context --json`.",
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
      "Use generated client APIs and framework bindings: React hooks or Vue composables.",
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

function buildGenericFiles(contract: AgentContract): AgentExportFile[] {
  return [
    { path: ".forge/agent/context.json", content: renderJson(buildAgentContext(contract)) },
    { path: ".forge/agent/commands.json", content: renderJson(buildAgentCommandsMap()) },
    { path: ".forge/agent/done-criteria.json", content: renderJson(buildAgentDoneCriteria()) },
    ...playbookFiles(),
  ];
}

function buildGenericSupportFiles(contract: AgentContract): AgentExportFile[] {
  return buildGenericFiles(contract);
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
1. Run \`forge status --json\`, \`forge handoff --json\`, and \`forge agent print-context --json\`.
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
forge status --json
forge handoff --json
forge dev --once --json
forge agent print-context --json
forge check --json
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
  if (target === "generic") {
    return { files: buildGenericFiles(contract), diagnostics: [] };
  }
  if (target === "codex") {
    return { files: [...buildGenericSupportFiles(contract), ...buildCodexFiles(contract, { skills: options.skills })], diagnostics: [] };
  }
  if (target === "cursor") {
    return { files: [...buildGenericSupportFiles(contract), ...buildCursorFiles(contract, { rules: options.rules })], diagnostics: [] };
  }
  if (target === "claude") {
    return { files: [...buildGenericSupportFiles(contract), ...buildClaudeFiles(contract)], diagnostics: [] };
  }
  if (target === "all") {
    const byPath = new Map<string, AgentExportFile>();
    for (const file of [
      ...buildGenericFiles(contract),
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
    diag.push(createDiagnostic({
      severity: "error",
      code: FORGE_AGENT_STALE_EXPORT,
      message: `stale agent adapter export: ${file}`,
      file,
      fixHint: `Regenerate the ${options.target} adapter export.`,
      suggestedCommands: [`forge agent export --target ${options.target}`, "forge verify --strict"],
      docs: ["src/forge/_generated/agentAdapterManifest.json", "AGENTS.md"],
    }));
  }
  for (const file of missing) {
    diag.push(createDiagnostic({
      severity: "error",
      code: FORGE_AGENT_STALE_EXPORT,
      message: `missing agent adapter export: ${file}`,
      file,
      fixHint: `Generate the ${options.target} adapter export.`,
      suggestedCommands: [`forge agent export --target ${options.target}`, "forge verify --strict"],
      docs: ["src/forge/_generated/agentAdapterManifest.json", "AGENTS.md"],
    }));
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

function eventBindings(event: AgentMemoryEventRecord): Record<string, unknown> {
  const data = event.data;
  const bindings = data && typeof data === "object" && "bindings" in data
    ? (data as { bindings?: unknown }).bindings
    : undefined;
  return bindings && typeof bindings === "object" && !Array.isArray(bindings)
    ? bindings as Record<string, unknown>
    : {};
}

function eventHasUsefulSignal(event: AgentMemoryEventRecord): boolean {
  const bindings = eventBindings(event);
  const files = bindings.files;
  const entries = bindings.entries;
  const proofs = bindings.proofs;
  return (
    typeof bindings.toolName === "string" ||
    typeof bindings.command === "string" ||
    typeof bindings.status === "string" ||
    (Array.isArray(files) && files.length > 0) ||
    (Array.isArray(entries) && entries.length > 0) ||
    (Array.isArray(proofs) && proofs.length > 0)
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function agentTimelineItem(event: AgentMemoryEventRecord): AgentTimelineItem {
  const bindings = eventBindings(event);
  return {
    id: event.id,
    source: event.sourceName,
    integration: event.integrationKind,
    trustLevel: event.trustLevel,
    kind: event.normalizedKind,
    capturedAt: event.capturedAt,
    ...(event.externalSessionId ? { sessionId: event.externalSessionId } : {}),
    ...(event.externalTurnId ? { turnId: event.externalTurnId } : {}),
    ...(event.summary ? { summary: event.summary } : {}),
    ...(stringValue(bindings.toolName) ? { toolName: stringValue(bindings.toolName) } : {}),
    ...(stringValue(bindings.command) ? { command: stringValue(bindings.command) } : {}),
    ...(stringValue(bindings.status) ? { status: stringValue(bindings.status) } : {}),
    files: stringArray(bindings.files),
    entries: stringArray(bindings.entries),
    proofs: stringArray(bindings.proofs),
    confidence: event.confidence,
  };
}

function agentTimelineSourceFilter(target: AgentAdapterTarget): string | undefined {
  if (!target || target === "all" || target === "generic") {
    return undefined;
  }
  return agentMemorySourceForTarget(target);
}

export async function runAgentTimeline(options: AgentCommandOptions): Promise<AgentTimelineResult> {
  const target = options.target || "all";
  const sourceFilter = agentTimelineSourceFilter(target);
  const requestedLimit = options.limit ?? 50;
  const memoryResult = await runAgentMemoryCommand({
    subcommand: "memory",
    workspaceRoot: options.workspaceRoot,
    json: true,
    target: "generic",
    source: "generic",
    limit: sourceFilter ? 200 : requestedLimit,
  });
  if (!("events" in memoryResult) || memoryResult.ok === false) {
    const diagnostics = "diagnostics" in memoryResult ? memoryResult.diagnostics ?? [] : [];
    const nextActions = "nextActions" in memoryResult
      ? memoryResult.nextActions ?? ["forge delta status --json"]
      : ["forge delta status --json"];
    return {
      schemaVersion: "0.1.0",
      ok: false,
      timeline: "agent",
      target,
      ...(sourceFilter ? { sourceFilter } : {}),
      summary: { events: 0, sessions: 0, files: 0, entries: 0, proofs: 0, tools: 0 },
      events: [],
      files: [],
      entries: [],
      proofs: [],
      sessions: [],
      nextActions,
      diagnostics,
      exitCode: 1,
    };
  }

  const filtered = sourceFilter
    ? memoryResult.events.filter((event) => event.sourceName === sourceFilter)
    : memoryResult.events;
  const events = filtered.slice(-requestedLimit).map(agentTimelineItem);
  const files = sorted(events.flatMap((event) => event.files));
  const entries = sorted(events.flatMap((event) => event.entries));
  const proofs = sorted(events.flatMap((event) => event.proofs));
  const sessions = sorted(events.flatMap((event) => event.sessionId ? [event.sessionId] : []));
  const tools = sorted(events.flatMap((event) => event.toolName ? [event.toolName] : []));
  return {
    schemaVersion: "0.1.0",
    ok: true,
    timeline: "agent",
    target,
    ...(sourceFilter ? { sourceFilter } : {}),
    summary: {
      events: events.length,
      sessions: sessions.length,
      files: files.length,
      entries: entries.length,
      proofs: proofs.length,
      tools: tools.length,
      ...(events.at(-1)?.capturedAt ? { latestEventAt: events.at(-1)?.capturedAt } : {}),
    },
    events,
    files,
    entries,
    proofs,
    sessions,
    nextActions: [
      "forge agent context --current --json",
      "forge changed --json",
      "forge timeline --json --for-agent",
    ],
    diagnostics: [],
    exitCode: 0,
  };
}

function agentMemorySourceForTarget(target: AgentAdapterTarget): string {
  if (target === "claude") return "claude-code";
  if (target === "codex" || target === "cursor" || target === "claude-code") return target;
  return String(target || "generic");
}

function hookInstallFilesPresent(workspaceRoot: string, installResult: unknown): {
  planned: string[];
  missing: string[];
} {
  const planned =
    installResult &&
    typeof installResult === "object" &&
    "filesPlanned" in installResult &&
    Array.isArray((installResult as { filesPlanned?: unknown }).filesPlanned)
      ? ((installResult as { filesPlanned: unknown[] }).filesPlanned.filter((file): file is string => typeof file === "string"))
      : [];
  return {
    planned,
    missing: planned.filter((file) => !nodeFileSystem.exists(join(workspaceRoot, file))),
  };
}

function lastAgentSignal(events: AgentMemoryEventRecord[]): AgentHooksStatusResult["lastSignal"] {
  const event = events.at(-1);
  return event
    ? {
        kind: event.normalizedKind,
        ...(event.summary ? { summary: event.summary } : {}),
        capturedAt: event.capturedAt,
      }
    : undefined;
}

async function readHookMemoryStatus(
  workspaceRoot: string,
  source: string,
  limit: number,
): Promise<{ events: AgentMemoryEventRecord[]; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = [];
  const memoryResult = await runAgentMemoryCommand({
    subcommand: "memory",
    workspaceRoot,
    json: true,
    target: source,
    source,
    entry: source,
    limit,
  }).catch((error: unknown) => {
    diagnostics.push(diagnostic(
      "error",
      "FORGE_AGENT_MEMORY_UNAVAILABLE",
      error instanceof Error ? error.message : "agent memory store is unavailable",
    ));
    return { ok: false as const, events: [], exitCode: 1 as const };
  });
  if (
    memoryResult &&
    typeof memoryResult === "object" &&
    "diagnostics" in memoryResult &&
    Array.isArray((memoryResult as { diagnostics?: unknown }).diagnostics)
  ) {
    diagnostics.push(...(memoryResult as { diagnostics: Diagnostic[] }).diagnostics);
  }
  return {
    events: "events" in memoryResult ? memoryResult.events ?? [] : [],
    diagnostics,
  };
}

async function readAgentHookStatus(options: AgentCommandOptions): Promise<AgentHooksStatusResult> {
  const target = options.target || "codex";
  const source = agentMemorySourceForTarget(target);
  const installTarget = hookInstallTarget(target);
  if (!installTarget) {
    const diag = diagnostic(
      "error",
      "FORGE_AGENT_HOOK_TARGET_UNSUPPORTED",
      `agent hooks supports codex, claude, and cursor targets; got ${target}`,
    );
    return {
      ok: false,
      target,
      installed: false,
      bridgeWritable: false,
      deltaWritable: false,
      visibleInMemory: false,
      recentEvents: 0,
      usefulSignals: 0,
      checks: [{ name: "target", ok: false, message: diag.message }],
      nextActions: ["forge agent list-targets --json"],
      diagnostics: [diag],
      exitCode: 1,
    };
  }

  const installResult = await runAgentMemoryCommand({
    subcommand: "install",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    target: installTarget,
    source: installTarget,
    dryRun: true,
    force: false,
  });
  const installOk =
    typeof installResult === "object" && installResult !== null && "exitCode" in installResult
      ? (installResult as { exitCode?: number }).exitCode === 0
      : true;
  const hookFiles = hookInstallFilesPresent(options.workspaceRoot, installResult);
  const memory = await readHookMemoryStatus(options.workspaceRoot, source, options.limit ?? 25);
  const usefulEvents = memory.events.filter(eventHasUsefulSignal);
  const installed = hookFiles.missing.length === 0;
  const bridgeWritable = installOk;
  const deltaWritable = memory.diagnostics.length === 0;
  const visibleInMemory = memory.events.length > 0;
  const usefulSignals = usefulEvents.length;
  const ok = installed && bridgeWritable && deltaWritable && visibleInMemory && usefulSignals > 0;
  const nextActions = ok
    ? [
        `forge agent memory --entry ${source} --json`,
        `forge agent context --current --json`,
      ]
    : [
        ...(!installed ? [`forge agent install ${installTarget} --json`] : []),
        ...(installed && !visibleInMemory ? [`forge agent hooks smoke --target ${target} --json`] : []),
        ...(visibleInMemory && usefulSignals === 0 ? [`forge agent ingest ${source} --event PostToolUse --json`] : []),
        ...(!deltaWritable ? ["forge delta status --json", "forge delta repair --dry-run --json"] : []),
      ];

  return {
    ok,
    target,
    installTarget,
    installed,
    bridgeWritable,
    deltaWritable,
    visibleInMemory,
    recentEvents: memory.events.length,
    usefulSignals,
    ...(lastAgentSignal(memory.events) ? { lastSignal: lastAgentSignal(memory.events) } : {}),
    checks: [
      {
        name: "hook-bridge-installed",
        ok: installed,
        message: installed
          ? `${installTarget} hook bridge files are present`
          : `missing hook bridge files: ${hookFiles.missing.join(", ")}`,
        evidence: { planned: hookFiles.planned, missing: hookFiles.missing },
      },
      {
        name: "hook-bridge-installable",
        ok: bridgeWritable,
        message: bridgeWritable ? "hook bridge install plan is valid" : "hook bridge install failed",
      },
      {
        name: "agent-memory-readable",
        ok: deltaWritable,
        message: deltaWritable ? "agent memory store is readable" : "agent memory store is unavailable",
      },
      {
        name: "visible-in-memory",
        ok: visibleInMemory,
        message: visibleInMemory ? `${memory.events.length} recent ${source} events visible` : "no hook events visible in memory yet",
      },
      {
        name: "useful-signals",
        ok: usefulSignals > 0,
        message: usefulSignals > 0
          ? `${usefulSignals} events include useful tool, file, command, status, entry, or proof signals`
          : "no useful tool, file, command, status, entry, or proof signals found",
      },
    ],
    nextActions,
    installResult,
    diagnostics: memory.diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

export async function runAgentDoctor(options: AgentCommandOptions): Promise<AgentDoctorResult> {
  const target = options.target || "generic";
  const check = runAgentCheck(options);
  const source = agentMemorySourceForTarget(target);
  const installTarget = hookInstallTarget(target);
  const installResult = installTarget
    ? await runAgentMemoryCommand({
        subcommand: "install",
        workspaceRoot: options.workspaceRoot,
        json: options.json,
        target: installTarget,
        source: installTarget,
        dryRun: true,
        force: false,
      })
    : undefined;
  const hookFiles = installTarget
    ? hookInstallFilesPresent(options.workspaceRoot, installResult)
    : { planned: [], missing: [] };
  const memoryDiagnostics: Diagnostic[] = [];
  const memoryResult = await runAgentMemoryCommand({
    subcommand: "memory",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    target: source,
    source,
    entry: source,
    limit: options.limit ?? 25,
  }).catch((error: unknown) => {
    memoryDiagnostics.push(diagnostic(
      "error",
      "FORGE_AGENT_MEMORY_UNAVAILABLE",
      error instanceof Error ? error.message : "agent memory store is unavailable",
    ));
    return { ok: false as const, events: [], exitCode: 1 as const };
  });
  if (
    memoryResult &&
    typeof memoryResult === "object" &&
    "diagnostics" in memoryResult &&
    Array.isArray((memoryResult as { diagnostics?: unknown }).diagnostics)
  ) {
    memoryDiagnostics.push(...(memoryResult as { diagnostics: Diagnostic[] }).diagnostics);
  }
  const recentEvents = "events" in memoryResult ? memoryResult.events ?? [] : [];
  const usefulEvents = recentEvents.filter(eventHasUsefulSignal);
  const adapterState = check.missing.length > 0 ? "missing" : check.stale.length > 0 ? "stale" : "ready";
  const hookBridgeState = !installTarget
    ? "not-supported"
    : hookFiles.missing.length === 0
      ? "ready"
      : "missing";
  const checks = [
    {
      name: "adapter-export",
      ok: check.missing.length === 0 && check.stale.length === 0,
      message: adapterState === "ready" ? "agent adapter exports are current" : `adapter exports are ${adapterState}`,
      evidence: { missing: check.missing, stale: check.stale },
    },
    { name: "AGENTS.md", ok: readText(options.workspaceRoot, "AGENTS.md") !== null },
    { name: "agent-context", ok: !check.missing.includes(".forge/agent/context.json") },
    { name: "commands", ok: !check.missing.includes(".forge/agent/commands.json") },
    { name: "done-criteria", ok: !check.missing.includes(".forge/agent/done-criteria.json") },
    {
      name: "hook-bridge",
      ok: !installTarget || hookFiles.missing.length === 0,
      message: !installTarget
        ? "this target has no native hook bridge"
        : hookFiles.missing.length === 0
          ? `${installTarget} hook bridge files are present`
          : `missing hook bridge files: ${hookFiles.missing.join(", ")}`,
      evidence: { target: installTarget, planned: hookFiles.planned, missing: hookFiles.missing },
    },
    {
      name: "recent-memory",
      ok: (!installTarget || recentEvents.length > 0) && memoryDiagnostics.length === 0,
      message: memoryDiagnostics.length > 0
        ? "agent memory store is unavailable"
        : recentEvents.length > 0
        ? `${recentEvents.length} recent ${source} memory events`
        : "no recent agent memory events found",
      evidence: recentEvents.slice(-5).map((event) => ({
        kind: event.normalizedKind,
        summary: event.summary,
        capturedAt: event.capturedAt,
      })),
    },
    {
      name: "useful-signals",
      ok: !installTarget || usefulEvents.length > 0,
      message: usefulEvents.length > 0
        ? `${usefulEvents.length} events include files, entries, commands, tools, status, or proofs`
        : "events do not yet include useful files, entries, commands, tools, status, or proofs",
    },
    { name: "secret-scan", ok: !check.diagnostics.some((diag) => diag.code === FORGE_AGENT_SECRET_LEAK) },
  ];
  const ok = checks.every((item) => item.ok) && check.exitCode === 0;
  const nextActions = ok
    ? [
        `forge agent context --current --json`,
        `forge agent memory --entry ${source} --json`,
      ]
    : [
        ...(check.missing.length > 0 || check.stale.length > 0 ? [`forge agent export --target ${target}`] : []),
        ...(installTarget && hookFiles.missing.length > 0 ? [`forge agent install ${installTarget} --json`] : []),
        ...(memoryDiagnostics.length > 0 ? ["forge delta status --json", "forge delta repair --dry-run --json"] : []),
        ...(installTarget && recentEvents.length === 0 && memoryDiagnostics.length === 0 ? [`forge agent hooks smoke --target ${target} --json`] : []),
        ...(installTarget && recentEvents.length > 0 && usefulEvents.length === 0 ? [`forge agent ingest ${source} --event PostToolUse --json`] : []),
      ];
  return {
    ok,
    target,
    summary: {
      adapter: adapterState,
      hookBridge: hookBridgeState,
      recentEvents: recentEvents.length,
      usefulSignals: usefulEvents.length,
      ...(recentEvents.at(-1)?.capturedAt ? { lastEventAt: recentEvents.at(-1)?.capturedAt } : {}),
    },
    checks,
    nextActions,
    diagnostics: [...check.diagnostics, ...memoryDiagnostics],
    exitCode: ok ? 0 : 1,
  };
}

function hookInstallTarget(target: AgentAdapterTarget): string | null {
  if (target === "codex") return "codex";
  if (target === "claude") return "claude-code";
  if (target === "cursor") return "cursor";
  return null;
}

function openCommandForTarget(target: AgentAdapterTarget): string | undefined {
  if (target === "codex") return "codex";
  if (target === "claude") return "claude";
  if (target === "cursor") return "cursor .";
  return undefined;
}

function agentCommandHints(target: AgentAdapterTarget): AgentPrepareResult["commands"] {
  const installTarget = hookInstallTarget(target);
  return {
    context: "forge agent context --current --json",
    export: `forge agent export --target ${target}`,
    check: `forge agent check --target ${target} --json`,
    ...(installTarget ? { install: `forge agent install ${installTarget} --json` } : {}),
    ...(installTarget ? { hooksStatus: `forge agent hooks status --target ${target} --json` } : {}),
    ...(installTarget ? { hooksSmoke: `forge agent hooks smoke --target ${target} --json` } : {}),
    ...(openCommandForTarget(target) ? { open: openCommandForTarget(target) } : {}),
  };
}

export async function runAgentPrepare(options: AgentCommandOptions): Promise<AgentPrepareResult> {
  const target = options.target || "generic";
  const exportResult = runAgentExport({ ...options, target });
  const installTarget = hookInstallTarget(target);
  const installResult = installTarget
    ? await runAgentMemoryCommand({
        subcommand: "install",
        workspaceRoot: options.workspaceRoot,
        json: options.json,
        target: installTarget,
        source: installTarget,
        dryRun: options.dryRun,
        force: options.force,
      })
    : undefined;
  const checkResult = runAgentCheck({ ...options, target });
  const diagnostics = [
    ...exportResult.diagnostics,
    ...checkResult.diagnostics,
  ];
  const installOk =
    !installResult ||
    (typeof installResult === "object" && installResult !== null && "exitCode" in installResult
      ? (installResult as { exitCode?: number }).exitCode === 0
      : true);
  const ok = exportResult.ok && checkResult.ok && installOk;
  return {
    ok,
    target,
    exportResult,
    checkResult,
    ...(installResult ? { installResult } : {}),
    commands: agentCommandHints(target),
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

function uniqueCommands(commands: Array<string | undefined>): string[] {
  return [...new Set(commands.filter((command): command is string => Boolean(command)))];
}

export async function runAgentOnboard(options: AgentCommandOptions): Promise<AgentOnboardResult> {
  const target = options.target || "codex";
  const installTarget = hookInstallTarget(target);
  const initialContext = runAgentPrintContext(options.workspaceRoot);
  const preflightDev = initialContext.context === null
    ? await runDevConsoleCycle({
        workspaceRoot: options.workspaceRoot,
        mode: "once",
        strictSecrets: false,
        includeImpact: false,
      })
    : undefined;
  const prepare = await runAgentPrepare({ ...options, target });
  const hookSmoke = installTarget && !options.dryRun
    ? await runAgentHooksSmoke({ ...options, target, subcommand: "hooks", hookAction: "smoke" })
    : undefined;
  const doctor = await runAgentDoctor({ ...options, target, subcommand: "doctor" });
  const context = runAgentPrintContext(options.workspaceRoot);
  const dev = await runDevConsoleCycle({
    workspaceRoot: options.workspaceRoot,
    mode: "once",
    strictSecrets: true,
    includeImpact: true,
  });
  const agentContext = dev.summary.agentContext;
  const diagnostics = [
    ...(preflightDev?.ok ? [] : initialContext.diagnostics),
    ...(preflightDev?.diagnostics ?? []),
    ...prepare.diagnostics,
    ...(hookSmoke?.diagnostics ?? []),
    ...doctor.diagnostics,
    ...context.diagnostics,
    ...dev.diagnostics,
  ];
  const readyToEdit =
    prepare.ok &&
    context.context !== null &&
    dev.ok &&
    agentContext.safeToEdit &&
    (!hookSmoke || hookSmoke.ok) &&
    doctor.summary.adapter === "ready";
  const steps = [
    ...(preflightDev
      ? [{
          name: "generated-preflight",
          ok: preflightDev.ok,
          message: preflightDev.ok
            ? "generated context was created before adapter preparation"
            : "generated context preflight failed",
        }]
      : []),
    {
      name: "adapter-prepare",
      ok: prepare.ok,
      message: prepare.ok
        ? `${target} adapter files are present and current`
        : `${target} adapter files need attention`,
    },
    ...(hookSmoke
      ? [{
          name: "hook-smoke",
          ok: hookSmoke.ok,
          message: hookSmoke.ok
            ? `${target} hooks recorded a useful canary signal`
            : `${target} hooks did not prove memory visibility`,
        }]
      : [{
          name: "hook-smoke",
          ok: !installTarget,
          message: installTarget
            ? "hook smoke skipped because this was a dry run"
            : "this target has no native hook bridge",
        }]),
    {
      name: "agent-doctor",
      ok: doctor.ok,
      message: doctor.ok ? "adapter, hooks, and memory are ready" : "agent doctor found follow-up actions",
    },
    {
      name: "dev-snapshot",
      ok: dev.ok && agentContext.safeToEdit,
      message: dev.ok
        ? `safeToEdit=${agentContext.safeToEdit}; generatedFresh=${agentContext.generatedFresh}; generatedChangedFiles=${agentContext.generatedChangedFiles}; changedFiles=${agentContext.changedFiles}`
        : "dev snapshot found blocking diagnostics",
    },
    {
      name: "context",
      ok: context.context !== null,
      message: context.context ? "generated agent context is readable" : "generated agent context is missing",
    },
  ];
  const commandHints = agentCommandHints(target);
  const nextActions = readyToEdit
    ? uniqueCommands([
        commandHints.open,
        "forge changed --json",
        "forge agent context --current --json",
        "forge do verify --json",
      ])
    : uniqueCommands([
        ...doctor.nextActions,
        ...dev.nextActions.map((action) => action.command),
        ...(context.context ? [] : ["forge generate"]),
        "forge dev --once --json",
      ]);
  return {
    schemaVersion: "0.1.0",
    ok: readyToEdit,
    target,
    readyToEdit,
    summary: {
      adapter: doctor.summary.adapter,
      hookBridge: doctor.summary.hookBridge,
      memorySignals: doctor.summary.usefulSignals,
      generatedFresh: agentContext.generatedFresh,
      generatedChanged: agentContext.generatedChanged,
      generatedChangedFiles: agentContext.generatedChangedFiles,
      safeToEdit: agentContext.safeToEdit,
      changedFiles: agentContext.changedFiles,
      ...(dev.summary.primaryAction?.command ? { primaryAction: dev.summary.primaryAction.command } : {}),
    },
    steps,
    recommendedReadFiles: agentContext.recommendedReadFiles,
    commands: {
      changed: "forge changed --json",
      dev: "forge dev --once --json",
      context: "forge agent context --current --json",
      verify: "forge do verify --json",
      ...(commandHints.hooksStatus ? { hooksStatus: commandHints.hooksStatus } : {}),
      ...(commandHints.hooksSmoke ? { hooksSmoke: commandHints.hooksSmoke } : {}),
      ...(commandHints.open ? { open: commandHints.open } : {}),
    },
    nextActions,
    diagnostics,
    exitCode: readyToEdit ? 0 : 1,
  };
}

export async function runAgentHooksStatus(options: AgentCommandOptions): Promise<AgentHooksStatusResult> {
  return readAgentHookStatus(options);
}

export async function runAgentHooksSmoke(options: AgentCommandOptions): Promise<AgentHooksSmokeResult> {
  const target = options.target || "codex";
  const installTarget = hookInstallTarget(target);
  const source = agentMemorySourceForTarget(target);
  const canaryMarker = "FORGE_HOOK_SMOKE_CANARY";
  if (!installTarget) {
    const diag = diagnostic(
      "error",
      "FORGE_AGENT_HOOK_TARGET_UNSUPPORTED",
      `agent hook smoke supports codex, claude, and cursor targets; got ${target}`,
    );
    return {
      ok: false,
      target,
      installed: false,
      bridgeWritable: false,
      deltaWritable: false,
      visibleInMemory: false,
      usefulSignals: 0,
      checks: [{ name: "target", ok: false, message: diag.message }],
      nextActions: ["forge agent list-targets --json"],
      diagnostics: [diag],
      exitCode: 1,
    };
  }

  const installResult = await runAgentMemoryCommand({
    subcommand: "install",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    target: installTarget,
    source: installTarget,
    dryRun: options.dryRun,
    force: options.force,
  });
  const installOk =
    typeof installResult === "object" && installResult !== null && "exitCode" in installResult
      ? (installResult as { exitCode?: number }).exitCode === 0
      : true;

  const ingestResult = options.dryRun
    ? undefined
    : await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: options.workspaceRoot,
        json: options.json,
        target: installTarget,
        source: installTarget,
        eventName: installTarget === "cursor" ? "FileChange" : "SessionStart",
        input: {
          forgeHookCanary: canaryMarker,
          cwd: options.workspaceRoot,
          provider: installTarget,
          status: "completed",
          summary: "Forge hook smoke event recorded",
          filesChanged: ["AGENTS.md"],
          command: "forge agent hooks smoke",
        },
      });
  const ingestOk =
    options.dryRun ||
    (typeof ingestResult === "object" && ingestResult !== null && "exitCode" in ingestResult
      ? (ingestResult as { exitCode?: number }).exitCode === 0
      : false);
  const ingestDiagnostics =
    ingestResult &&
    typeof ingestResult === "object" &&
    "diagnostics" in ingestResult &&
    Array.isArray((ingestResult as { diagnostics?: unknown }).diagnostics)
      ? (ingestResult as { diagnostics: Diagnostic[] }).diagnostics
      : [];
  const ingestNextActions =
    ingestResult &&
    typeof ingestResult === "object" &&
    "nextActions" in ingestResult &&
    Array.isArray((ingestResult as { nextActions?: unknown }).nextActions)
      ? (ingestResult as { nextActions: unknown[] }).nextActions.filter((action): action is string => typeof action === "string")
      : [];
  const ingestStoreBusy = ingestDiagnostics.some((diag) => diag.code === "FORGE_DELTA_BUSY");
  const ingestedEventId =
    ingestResult &&
    typeof ingestResult === "object" &&
    "event" in ingestResult &&
    (ingestResult as { event?: { id?: string } }).event?.id;
  const memoryAfterSmoke = options.dryRun
    ? { events: [], diagnostics: [] as Diagnostic[] }
    : await readHookMemoryStatus(options.workspaceRoot, source, Math.max(options.limit ?? 25, 50));
  const status = await readAgentHookStatus({ ...options, target });
  const canaryEvent = ingestedEventId
    ? memoryAfterSmoke.events.find((event) => event.id === ingestedEventId)
    : undefined;
  const visibleInMemory = options.dryRun
    ? false
    : Boolean(canaryEvent);
  const checks = [
    { name: "hook-install", ok: installOk, message: installOk ? "hook bridge files are available" : "hook bridge install failed" },
    { name: "canary-ingest", ok: ingestOk, message: options.dryRun ? "dry-run skipped ingest" : ingestOk ? "canary event was normalized and stored" : "canary ingest failed" },
    {
      name: "canary-memory-readable",
      ok: options.dryRun || memoryAfterSmoke.diagnostics.length === 0,
      message: options.dryRun
        ? "dry-run skipped memory read"
        : memoryAfterSmoke.diagnostics.length === 0
          ? `${memoryAfterSmoke.events.length} memory event(s) inspected after canary ingest`
          : "agent memory was not readable after canary ingest",
    },
    {
      name: "canary-visible",
      ok: options.dryRun || !ingestOk || visibleInMemory,
      message: options.dryRun
        ? "dry-run skipped memory visibility check"
        : !ingestOk
          ? "not checked because canary ingest failed"
        : visibleInMemory
          ? "canary event is visible in agent memory"
          : "canary event was not visible in agent memory",
    },
  ];
  const diagnostics = [
    ...ingestDiagnostics,
    ...memoryAfterSmoke.diagnostics,
    ...(!installOk
      ? [diagnostic("error", "FORGE_AGENT_HOOK_INSTALL_FAILED", `hook bridge install failed for ${installTarget}`)]
      : []),
    ...(!ingestOk && !ingestStoreBusy
      ? [diagnostic(
          "error",
          "FORGE_AGENT_HOOK_CANARY_MISSING",
          `Forge hook smoke did not record a canary event for ${installTarget}; install hooks and restart the external agent, then run forge agent hooks smoke --target ${target} --json`,
        )]
      : []),
    ...(!options.dryRun && ingestOk && !visibleInMemory
      ? [createDiagnostic({
          severity: "error",
          code: "FORGE_AGENT_HOOK_CANARY_NOT_VISIBLE",
          message: `Forge hook smoke ingested canary ${ingestedEventId ?? canaryMarker} for ${installTarget}, but that event was not visible in agent memory; inspect hook status and DeltaDB before trusting hooks.`,
          suggestedCommands: [`forge agent hooks status --target ${target} --json`, `forge agent memory --entry ${source} --json`, "forge delta status --json"],
        })]
      : []),
  ];
  const ok = checks.every((check) => check.ok);
  return {
    ok,
    target,
    installTarget,
    installed: status.installed,
    bridgeWritable: installOk,
    deltaWritable: status.deltaWritable && ingestOk && memoryAfterSmoke.diagnostics.length === 0,
    visibleInMemory,
    usefulSignals: status.usefulSignals,
    ...(canaryEvent ? { lastSignal: lastAgentSignal([canaryEvent]) } : status.lastSignal ? { lastSignal: status.lastSignal } : {}),
    canary: {
      marker: canaryMarker,
      source,
      eventName: installTarget === "cursor" ? "FileChange" : "SessionStart",
      ...(ingestedEventId ? { ingestedEventId } : {}),
      memoryEventsChecked: memoryAfterSmoke.events.length,
      visible: visibleInMemory,
    },
    checks,
    nextActions: ok
      ? [`forge agent hooks status --target ${target} --json`, `forge agent memory --entry ${source} --json`]
      : uniqueCommands([
          ...ingestNextActions,
          ...status.nextActions,
          `forge agent hooks status --target ${target} --json`,
          `forge agent memory --entry ${source} --json`,
          `forge agent timeline --target ${target} --json`,
          "forge delta status --json",
        ]),
    installResult,
    ...(ingestResult ? { ingestResult } : {}),
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

export async function runAgentCommand(options: AgentCommandOptions): Promise<
  AgentExportResult | AgentCheckResult | AgentTargetsResult | AgentPrintContextResult | AgentDoctorResult | AgentPrepareResult | AgentOnboardResult | AgentHooksSmokeResult | AgentHooksStatusResult | AgentTimelineResult | AgentMemoryCommandResult
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
  if (options.subcommand === "onboard") {
    return runAgentOnboard({ ...options, target: options.target || "codex" });
  }
  if (options.subcommand === "print-context") {
    return runAgentPrintContext(options.workspaceRoot);
  }
  if (options.subcommand === "clean") {
    return runAgentClean(options);
  }
  if (options.subcommand === "prepare") {
    return runAgentPrepare(options);
  }
  if (options.subcommand === "hooks") {
    if (options.hookAction === "status") {
      return runAgentHooksStatus(options);
    }
    return runAgentHooksSmoke(options);
  }
  if (options.subcommand === "timeline") {
    return runAgentTimeline(options);
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
      watch: options.watch,
      file: options.file,
      pollIntervalMs: options.pollIntervalMs,
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
  if ("timeline" in result && result.timeline === "agent") {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  if ("privacy" in result || "event" in result || "agentMemory" in result || "events" in result || "watch" in result) {
    return formatAgentMemoryJson(result as AgentMemoryCommandResult);
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAgentHuman(result: Awaited<ReturnType<typeof runAgentCommand>>): string {
  if ("timeline" in result && result.timeline === "agent") {
    return [
      `agent timeline for ${result.target}: ${result.summary.events} event(s)`,
      ...(result.summary.latestEventAt ? [`latest: ${result.summary.latestEventAt}`] : []),
      ...(result.files.length > 0 ? [`files: ${result.files.slice(0, 8).join(", ")}`] : []),
      ...(result.entries.length > 0 ? [`entries: ${result.entries.slice(0, 8).join(", ")}`] : []),
      "",
      ...result.events.slice(-12).map((event) => {
        const parts = [
          event.capturedAt,
          event.source,
          event.kind,
          event.toolName,
          event.status,
          event.summary,
        ].filter(Boolean);
        return `- ${parts.join(" | ")}`;
      }),
      ...(result.nextActions.length > 0 ? ["", "Next:", ...result.nextActions.map((command) => `  ${command}`)] : []),
    ].join("\n") + "\n";
  }
  if ("privacy" in result || "event" in result || "agentMemory" in result || "events" in result || "watch" in result) {
    return formatAgentMemoryHuman(result as AgentMemoryCommandResult);
  }
  if ("targets" in result) {
    return `${result.targets.map((target) => `${target.name}${target.default ? " (default)" : ""}${target.optional ? " (optional)" : ""}${target.custom ? " (custom)" : ""}`).join("\n")}\n`;
  }
  if ("context" in result) {
    return `${JSON.stringify(result.context, null, 2)}\n`;
  }
  if ("exportResult" in result) {
    return [
      `agent prepare ${result.ok ? "ok" : "failed"} for ${result.target}`,
      "commands:",
      ...Object.entries(result.commands).map(([name, command]) => `- ${name}: ${command}`),
      "files written:",
      ...(result.exportResult.filesWritten.length > 0 ? result.exportResult.filesWritten.map((file) => `- ${file}`) : ["- none"]),
    ].join("\n") + "\n";
  }
  if ("readyToEdit" in result) {
    return [
      `agent onboard ${result.ok ? "ready" : "needs attention"} for ${result.target}`,
      `ready to edit: ${result.readyToEdit ? "yes" : "no"}`,
      `generated fresh: ${result.summary.generatedFresh ? "yes" : "no"}`,
      `generated changed: ${result.summary.generatedChangedFiles}`,
      `changed files: ${result.summary.changedFiles}`,
      "",
      "steps:",
      ...result.steps.map((step) => `${step.ok ? "OK" : "WARN"} ${step.name}: ${step.message}`),
      ...(result.nextActions.length > 0 ? ["", "Next:", ...result.nextActions.map((command) => `  ${command}`)] : []),
    ].join("\n") + "\n";
  }
  if ("ingestResult" in result || ("checks" in result && "installResult" in result)) {
    const smoke = result as AgentHooksSmokeResult;
    return [
      `agent hooks smoke ${smoke.ok ? "ok" : "failed"} for ${smoke.target}`,
      ...smoke.checks.map((check) => `${check.ok ? "OK" : "FAIL"} ${check.name}${check.message ? `: ${check.message}` : ""}`),
      ...(smoke.canary
        ? [
            "",
            "Canary:",
            `  marker: ${smoke.canary.marker}`,
            `  source: ${smoke.canary.source}`,
            `  event: ${smoke.canary.eventName}`,
            ...(smoke.canary.ingestedEventId ? [`  ingested id: ${smoke.canary.ingestedEventId}`] : []),
            `  memory events checked: ${smoke.canary.memoryEventsChecked}`,
            `  visible: ${smoke.canary.visible ? "yes" : "no"}`,
          ]
        : []),
      ...(smoke.lastSignal
        ? [
            "",
            `last signal: ${smoke.lastSignal.kind}${smoke.lastSignal.summary ? ` - ${smoke.lastSignal.summary}` : ""}`,
            `captured at: ${smoke.lastSignal.capturedAt}`,
          ]
        : []),
      ...(smoke.nextActions.length > 0 ? ["", "Next:", ...smoke.nextActions.map((command) => `  ${command}`)] : []),
    ].join("\n") + "\n";
  }
  if ("installed" in result && "visibleInMemory" in result) {
    return [
      `agent hooks status ${result.ok ? "ready" : "needs attention"} for ${result.target}`,
      `installed: ${result.installed ? "yes" : "no"}`,
      `bridge writable: ${result.bridgeWritable ? "yes" : "no"}`,
      `delta writable: ${result.deltaWritable ? "yes" : "no"}`,
      `visible in memory: ${result.visibleInMemory ? "yes" : "no"}`,
      `useful signals: ${result.usefulSignals}`,
      ...("recentEvents" in result ? [`recent events: ${result.recentEvents}`] : []),
      ...(result.lastSignal ? [`last signal: ${result.lastSignal.kind}${result.lastSignal.summary ? ` - ${result.lastSignal.summary}` : ""}`] : []),
      ...(result.nextActions.length > 0 ? ["", "Next:", ...result.nextActions.map((command) => `  ${command}`)] : []),
    ].join("\n") + "\n";
  }
  if ("checks" in result) {
    const nextActions = "nextActions" in result && Array.isArray(result.nextActions)
      ? result.nextActions as string[]
      : [];
    return [
      `Forge Agent Doctor ${result.ok ? "ready" : "needs attention"}`,
      "",
      ...result.checks.map((check) => `${check.ok ? "OK" : "WARN"} ${check.name}${check.message ? `: ${check.message}` : ""}`),
      ...(nextActions.length > 0 ? ["", "Next:", ...nextActions.map((command) => `  ${command}`)] : []),
    ].join("\n") + "\n";
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
