import { join } from "node:path";
import type { AgentContract } from "../compiler/agent-contract/types.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type {
  ForgeDoOptions,
  ForgeIntentCommand,
  ForgeIntentConfidence,
  ForgeIntentContextSummary,
  ForgeIntentKind,
  ForgeIntentPlanStep,
  ForgeIntentResult,
  ForgeIntentRisk,
} from "./types.ts";

const STOPWORDS = new Set([
  "a",
  "add",
  "adicionar",
  "app",
  "com",
  "create",
  "criar",
  "crie",
  "de",
  "feature",
  "for",
  "make",
  "new",
  "nova",
  "novo",
  "o",
  "resource",
  "the",
  "ui",
  "uma",
  "with",
]);

function readGeneratedJson<T>(workspaceRoot: string, relativePath: string): T | null {
  const absolute = join(workspaceRoot, relativePath);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "")) as T;
  } catch {
    return null;
  }
}

function tokenize(objective: string): string[] {
  return objective
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort();
}

function includesAny(tokens: string[], words: string[]): boolean {
  return words.some((word) => tokens.includes(word));
}

function classifyIntent(tokens: string[]): { kind: ForgeIntentKind; confidence: ForgeIntentConfidence } {
  if (tokens.length === 0) {
    return { kind: "inspect", confidence: "low" };
  }
  if (includesAny(tokens, ["fix", "repair", "corrigir", "consertar", "erro", "errors", "falha", "failing"])) {
    return { kind: "fix", confidence: "high" };
  }
  if (includesAny(tokens, ["verify", "validar", "test", "teste", "tests", "check", "100"])) {
    return { kind: "verify", confidence: "high" };
  }
  if (includesAny(tokens, ["ship", "handoff", "release", "commit", "pr", "push", "entregar"])) {
    return { kind: "ship", confidence: "medium" };
  }
  if (includesAny(tokens, ["frontend", "ui", "route", "rota", "component", "page", "hook", "connect", "conectar"])) {
    if (includesAny(tokens, ["add", "create", "criar", "crie", "resource", "feature", "nova", "novo"])) {
      return { kind: "add-feature", confidence: "high" };
    }
    return { kind: "connect-ui", confidence: "high" };
  }
  if (includesAny(tokens, ["add", "create", "criar", "crie", "make", "resource", "feature", "table", "command", "query"])) {
    return { kind: "add-feature", confidence: "medium" };
  }
  if (includesAny(tokens, ["explain", "explicar", "entender", "describe", "mapa", "architecture", "arquitetura"])) {
    return { kind: "explain", confidence: "high" };
  }
  return { kind: "inspect", confidence: "medium" };
}

function labelFor(kind: ForgeIntentKind): string {
  switch (kind) {
    case "add-feature":
      return "Add a feature safely";
    case "connect-ui":
      return "Connect or repair frontend wiring";
    case "explain":
      return "Explain the project";
    case "fix":
      return "Diagnose and repair failures";
    case "inspect":
      return "Inspect the project";
    case "ship":
      return "Prepare a handoff or commit";
    case "verify":
      return "Verify changes";
  }
}

function extractResourceName(tokens: string[]): string {
  const afterTrigger = tokens.findIndex((token) =>
    ["add", "create", "criar", "crie", "make", "resource", "feature", "table"].includes(token),
  );
  const candidates = tokens
    .slice(afterTrigger >= 0 ? afterTrigger + 1 : 0)
    .filter((token) => !STOPWORDS.has(token) && !token.includes("."));
  return candidates[0] ?? "<name>";
}

function baseFiles(contract: AgentContract | null): string[] {
  return uniqueSorted([
    "AGENTS.md",
    `${GENERATED_DIR}/agentContract.json`,
    `${GENERATED_DIR}/frontendGraph.json`,
    `${GENERATED_DIR}/appMap.md`,
    `${GENERATED_DIR}/runtimeRules.md`,
    `${GENERATED_DIR}/operationPlaybooks.md`,
    ...(contract?.frontend.routes.map((route) => route.file) ?? []),
    ...(contract?.frontend.bridgeFiles ?? []),
  ]);
}

function contextSummary(contract: AgentContract | null): ForgeIntentContextSummary {
  return {
    ...(contract?.project.name ? { projectName: contract.project.name } : {}),
    frontendPresent: contract?.frontend.present ?? false,
    frontendFramework: contract?.frontend.framework ?? "unknown",
    routes: contract?.frontend.routes.map((route) => route.path).sort() ?? [],
    commands: contract?.commands.map((command) => command.name).sort() ?? [],
    queries: contract?.queries.map((query) => query.name).sort() ?? [],
    liveQueries: contract?.liveQueries.map((query) => query.name).sort() ?? [],
  };
}

function intentCommand(command: string, purpose: string, when: ForgeIntentCommand["when"] = "now"): ForgeIntentCommand {
  return { command, purpose, when };
}

function step(
  title: string,
  why: string,
  commands: string[],
  filesToInspect: string[],
  successCriteria: string[],
): ForgeIntentPlanStep {
  return { title, why, commands, filesToInspect, successCriteria };
}

function risk(level: ForgeIntentRisk["level"], reason: string, mitigation: string): ForgeIntentRisk {
  return { level, reason, mitigation };
}

function planFor(input: {
  kind: ForgeIntentKind;
  objective: string;
  tokens: string[];
  contract: AgentContract | null;
}): {
  summary: string;
  plan: ForgeIntentPlanStep[];
  commands: ForgeIntentCommand[];
  filesToInspect: string[];
  filesToChange: string[];
  risks: ForgeIntentRisk[];
} {
  const files = baseFiles(input.contract);
  const resourceName = extractResourceName(input.tokens);
  switch (input.kind) {
    case "add-feature": {
      const withUi = includesAny(input.tokens, ["ui", "frontend", "page", "component", "route", "with"]);
      const dryRun = `forge make resource ${resourceName} --fields title:text,status:enum(open,closed)${withUi ? " --with-ui" : ""} --dry-run --json`;
      const apply = `forge make resource ${resourceName} --fields title:text,status:enum(open,closed)${withUi ? " --with-ui" : ""} --yes`;
      return {
        summary: `Plan a resource-style feature named '${resourceName}' and keep generated contracts in sync.`,
        plan: [
          step(
            "Inspect current app contract",
            "The agent should understand existing entries, policies, frontend routes, and generated rules before editing.",
            ["forge dev --once --json", "forge inspect all --json"],
            files,
            ["No stale generated artifacts", "Frontend/runtime diagnostics are visible before editing"],
          ),
          step(
            "Preview the scaffold",
            "Resource scaffolding can touch schema, commands, queries, policies, and UI, so preview before applying.",
            [dryRun],
            ["src/forge/schema.ts", "src/commands", "src/queries", "web"],
            ["Plan lists intended files", "Risk is understood before writes"],
          ),
          step(
            "Apply and verify",
            "After applying, regenerate contracts and run the focused dev diagnostic loop.",
            [apply, "forge generate", "forge dev --once --json"],
            [`${GENERATED_DIR}/agentContract.json`, `${GENERATED_DIR}/frontendGraph.json`],
            ["agentContract includes the new runtime entries", "frontendGraph reflects any route/component binding"],
          ),
        ],
        commands: [
          intentCommand("forge dev --once --json", "Get the current generated/check/frontend/doctor state"),
          intentCommand(dryRun, "Preview the feature scaffold"),
          intentCommand(apply, "Apply the reviewed scaffold", "after-review"),
          intentCommand("forge generate", "Refresh generated contracts after edits", "after-editing"),
          intentCommand("forge dev --once --json", "Re-run the central diagnostic loop", "after-editing"),
        ],
        filesToInspect: files,
        filesToChange: uniqueSorted(["src/forge/schema.ts", "src/commands", "src/queries", ...(withUi ? ["web"] : [])]),
        risks: [
          risk("medium", "Resource scaffolds can alter schema and policies.", "Use the dry-run plan first and verify generated artifacts afterward."),
          risk(withUi ? "medium" : "low", "Frontend bindings can drift from generated hooks.", "Inspect frontendGraph and use the local web/lib/forge bridge."),
        ],
      };
    }
    case "connect-ui":
      return {
        summary: "Inspect and repair the web app bridge, provider, routes, and generated hook usage.",
        plan: [
          step(
            "Read frontend graph",
            "frontendGraph is the source of truth for routes, components, providers, bridge files, and raw fetch warnings.",
            ["forge inspect frontend --json", "forge dev --once --json"],
            files,
            ["Routes and bridge files are visible", "Any frontend diagnostics include fix hints"],
          ),
          step(
            "Create or repair UI bridge",
            "Forge frontends should use the local bridge and hooks instead of fragile direct runtime fetches.",
            ["forge make ui --framework vite --dry-run --json", "forge repair diagnose --diagnostic FORGE_FRONTEND_DIRECT_RUNTIME_FETCH --json"],
            ["web/src/lib/forge.ts", "web/src/App.tsx", `${GENERATED_DIR}/frontendGraph.json`],
            ["ForgeProvider is mounted when framework needs it", "useQuery/useCommand/useLiveQuery replace raw endpoint fetches"],
          ),
        ],
        commands: [
          intentCommand("forge inspect frontend --json", "Inspect frontend wiring"),
          intentCommand("forge dev --once --json", "Run the central diagnostic loop"),
          intentCommand("forge make ui --framework vite --dry-run --json", "Preview adding a Forge-ready UI bridge", "after-review"),
          intentCommand("forge generate", "Refresh frontendGraph and agentContract", "after-editing"),
        ],
        filesToInspect: files,
        filesToChange: uniqueSorted(["web", "web/src/lib/forge.ts", "web/src/App.tsx"]),
        risks: [
          risk("medium", "UI can appear to work while bypassing generated hooks.", "Treat frontendGraph diagnostics as blocking for agent handoff."),
        ],
      };
    case "fix":
      return {
        summary: "Use the dev console and repair loop instead of guessing at failing checks.",
        plan: [
          step(
            "Collect current diagnostics",
            "The central dev cycle aggregates generated drift, guardrails, frontend wiring, doctor checks, impact, and last reports.",
            ["forge dev --once --json"],
            files,
            ["Diagnostics include codes, fix hints, and suggested commands"],
          ),
          step(
            "Use repair inputs",
            "Repair should be grounded in last test/UI reports or a specific diagnostic code.",
            [
              "forge repair diagnose --from-last-test-run --json",
              "forge repair diagnose --from-last-ui-run --json",
              "forge repair plan --from-last-test-run --write",
            ],
            [".forge/test-runs/last.json", ".forge/ui-runs/last.json"],
            ["Only high-confidence deterministic repairs are applied automatically"],
          ),
        ],
        commands: [
          intentCommand("forge dev --once --json", "Collect current diagnostics"),
          intentCommand("forge repair diagnose --from-last-test-run --json", "Diagnose last test failures", "after-review"),
          intentCommand("forge repair diagnose --from-last-ui-run --json", "Diagnose last UI failures", "after-review"),
          intentCommand("forge dev --once --json", "Confirm the repair loop changed the state", "after-editing"),
        ],
        filesToInspect: uniqueSorted([...files, ".forge/test-runs/last.json", ".forge/ui-runs/last.json"]),
        filesToChange: [],
        risks: [
          risk("medium", "Blind fixes can make generated/runtime drift worse.", "Start from diagnostic codes and use repair plans before editing."),
        ],
      };
    case "verify":
      return {
        summary: "Run focused checks first, then strict verification before handoff.",
        plan: [
          step(
            "Get changed-file impact",
            "Impact planning keeps verification fast while still choosing relevant checks.",
            ["forge dev --once --json", "forge test plan --changed --json"],
            files,
            ["Changed files and recommended checks are listed"],
          ),
          step(
            "Finish strict when ready",
            "Strict verification is the handoff gate once focused checks pass.",
            ["forge verify --changed", "forge verify --strict"],
            ["AGENTS.md", `${GENERATED_DIR}/agentContract.json`],
            ["Focused verification passes", "Strict verification passes before commit/push"],
          ),
        ],
        commands: [
          intentCommand("forge dev --once --json", "Run central diagnostics"),
          intentCommand("forge test plan --changed --json", "Plan targeted checks from changed files"),
          intentCommand("forge verify --changed", "Run focused verification", "after-editing"),
          intentCommand("forge verify --strict", "Run final strict verification", "before-handoff"),
        ],
        filesToInspect: files,
        filesToChange: [],
        risks: [
          risk("low", "Focused checks may miss broad integration regressions.", "Use forge verify --strict before final handoff."),
        ],
      };
    case "ship":
      return {
        summary: "Prepare a clean handoff with diagnostics, review, and strict verification.",
        plan: [
          step(
            "Review current state",
            "Handoffs need current generated artifacts, review findings, and changed-file impact.",
            ["forge dev --once --json", "forge review --changed --json", "git status --short"],
            files,
            ["No unexpected generated drift", "Review findings are known before commit"],
          ),
          step(
            "Run final gate",
            "Strict verification is the last framework-owned gate before a commit or push.",
            ["forge verify --strict"],
            ["AGENTS.md", `${GENERATED_DIR}/agentContract.json`],
            ["Strict verification passes"],
          ),
        ],
        commands: [
          intentCommand("forge dev --once --json", "Run central diagnostics"),
          intentCommand("forge review --changed --json", "Review changed files structurally"),
          intentCommand("forge verify --strict", "Run final strict verification", "before-handoff"),
        ],
        filesToInspect: files,
        filesToChange: [],
        risks: [
          risk("medium", "Committing stale generated artifacts confuses future agents.", "Run generate/check before final verification."),
        ],
      };
    case "explain":
    case "inspect":
      return {
        summary: "Read the generated contract and maps before opening individual files.",
        plan: [
          step(
            "Load agent context",
            "The generated contract is the fastest route to understanding runtime, data, frontend, policies, and commands.",
            ["forge inspect all --json", "forge agent print-context --json"],
            files,
            ["Contract and maps are available", "Frontend routes and runtime endpoints are known"],
          ),
          step(
            "Open the relevant source files",
            "Source reads should be driven by the generated map rather than broad repo scanning.",
            ["forge inspect frontend --json", "forge inspect map"],
            files,
            ["Files to inspect are narrowed to mapped routes, entries, or rules"],
          ),
        ],
        commands: [
          intentCommand("forge inspect all --json", "Read the aggregate project contract"),
          intentCommand("forge agent print-context --json", "Read the agent-facing context"),
          intentCommand("forge inspect frontend --json", "Read frontend routes and bindings"),
        ],
        filesToInspect: files,
        filesToChange: [],
        risks: [
          risk("low", "Reading source before generated maps wastes context.", "Start from AGENTS.md and agentContract.json."),
        ],
      };
  }
}

export function runForgeDoCommand(options: ForgeDoOptions): ForgeIntentResult {
  const objective = options.objective.trim() || "inspect project";
  const tokens = tokenize(objective);
  const contract = readGeneratedJson<AgentContract>(
    options.workspaceRoot,
    `${GENERATED_DIR}/agentContract.json`,
  );
  const classified = classifyIntent(tokens);
  const planned = planFor({
    kind: classified.kind,
    objective,
    tokens,
    contract,
  });
  const diagnostics = contract
    ? []
    : [
        createDiagnostic({
          severity: "warning",
          code: "FORGE_DO_CONTRACT_MISSING",
          message: "agentContract.json is missing or unreadable; plan uses conservative defaults",
          file: `${GENERATED_DIR}/agentContract.json`,
          fixHint: "Run forge generate before applying an intent plan.",
          suggestedCommands: ["forge generate", "forge dev --once --json"],
          docs: ["AGENTS.md"],
        }),
      ];
  const commands = planned.commands;
  return {
    schemaVersion: "0.1.0",
    ok: true,
    input: { objective, tokens },
    intent: {
      kind: classified.kind,
      label: labelFor(classified.kind),
      confidence: classified.confidence,
    },
    summary: planned.summary,
    context: contextSummary(contract),
    plan: planned.plan,
    commands,
    filesToInspect: planned.filesToInspect,
    filesToChange: planned.filesToChange,
    risks: planned.risks,
    diagnostics,
    nextAction: commands[0] ?? null,
    exitCode: 0,
  };
}

export function formatForgeDoJson(result: ForgeIntentResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatForgeDoHuman(result: ForgeIntentResult): string {
  const lines = [
    "Forge Do",
    "",
    `Intent: ${result.intent.kind} (${result.intent.confidence})`,
    `Summary: ${result.summary}`,
    "",
    "Plan:",
  ];
  for (let index = 0; index < result.plan.length; index++) {
    const item = result.plan[index];
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(`   ${item.why}`);
    for (const commandItem of item.commands) {
      lines.push(`   $ ${commandItem}`);
    }
  }
  if (result.filesToInspect.length > 0) {
    lines.push("", "Files to inspect:");
    for (const file of result.filesToInspect.slice(0, 12)) {
      lines.push(`- ${file}`);
    }
    if (result.filesToInspect.length > 12) {
      lines.push(`- ... ${result.filesToInspect.length - 12} more`);
    }
  }
  if (result.risks.length > 0) {
    lines.push("", "Risks:");
    for (const item of result.risks) {
      lines.push(`- ${item.level}: ${item.reason}`);
      lines.push(`  Mitigation: ${item.mitigation}`);
    }
  }
  if (result.nextAction) {
    lines.push("", "Next action:", `  ${result.nextAction.command}`);
  }
  return `${lines.join("\n")}\n`;
}

export type {
  ForgeDoOptions,
  ForgeIntentCommand,
  ForgeIntentResult,
} from "./types.ts";
