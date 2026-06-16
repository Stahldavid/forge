import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { createDbAdapter } from "../runtime/db/factory.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import { createAiContext } from "../runtime/ai/context.ts";
import {
  checkAiProviders,
  loadAiModels,
  loadAiProviders,
  loadAiRegistry,
} from "../runtime/ai/check.ts";
import { enqueueMockAiResponse } from "../runtime/ai/mock.ts";
import { getRuntimeEnvStore, initializeRuntimeEnv } from "../runtime/context/create-context.ts";
import { createNoopTelemetryContext } from "../runtime/telemetry/context.ts";
import { generateTraceId } from "../runtime/telemetry/correlation.ts";
import { inspectTrace } from "../runtime/telemetry/flush.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import { createRuntimeSecretsBundle } from "../runtime/secrets/runtime-bundle.ts";
import type { ForgeAiProvider } from "../runtime/ai/types.ts";

function loadAgentTools(workspaceRoot: string): { explicitTools?: unknown[]; autoTools?: unknown[]; agents?: unknown[] } | null {
  const path = join(workspaceRoot, GENERATED_DIR, "agentTools.json");
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(path) ?? "{}")) as {
      explicitTools?: unknown[];
      autoTools?: unknown[];
      agents?: unknown[];
    };
  } catch {
    return null;
  }
}

export type AiSubcommand =
  | "providers"
  | "check"
  | "test"
  | "models"
  | "tools"
  | "agents"
  | "redteam"
  | "trace";

export interface AiCommandOptions {
  subcommand: AiSubcommand;
  workspaceRoot: string;
  json: boolean;
  provider?: ForgeAiProvider;
  model?: string;
  prompt?: string;
  mock?: boolean;
  traceId?: string;
  db?: DbAdapterKind;
  databaseUrl?: string;
}

export interface AiCommandResult {
  exitCode: 0 | 1;
  data?: unknown;
  diagnostics?: ReturnType<typeof createDiagnostic>[];
}

export interface AiTraceSummary {
  traceId: string;
  agents: Array<Record<string, unknown>>;
  tools: Array<Record<string, unknown>>;
  generations: Array<Record<string, unknown>>;
  usage: Array<Record<string, unknown>>;
  failures: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  spans: Array<Record<string, unknown>>;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const path = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(path) ?? "{}")) as T;
  } catch {
    return null;
  }
}

function payloadOf(event: Record<string, unknown>): Record<string, unknown> {
  const payload = event.payload;
  if (typeof payload === "string") {
    try {
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

function eventName(payload: Record<string, unknown>): string {
  const event = payload.event;
  if (event && typeof event === "object" && "name" in event) {
    return String((event as { name?: unknown }).name ?? "");
  }
  return "";
}

function eventProperties(payload: Record<string, unknown>): Record<string, unknown> {
  const event = payload.event;
  if (event && typeof event === "object" && "properties" in event) {
    const properties = (event as { properties?: unknown }).properties;
    return properties && typeof properties === "object" ? properties as Record<string, unknown> : {};
  }
  return {};
}

interface AgentToolRecord {
  name?: unknown;
  risk?: unknown;
  needsApproval?: unknown;
  readOnly?: unknown;
  sourceKind?: unknown;
}

interface AgentRecord {
  name?: unknown;
  stopWhen?: unknown;
  maxSteps?: unknown;
}

interface AiRedteamScenario {
  id: string;
  name: string;
  status: "passed" | "failed" | "not-applicable";
  evidence: string;
}

function toolName(tool: AgentToolRecord): string {
  return typeof tool.name === "string" && tool.name.length > 0 ? tool.name : "<anonymous>";
}

function toolNeedsApproval(tool: AgentToolRecord): boolean {
  return tool.needsApproval === true || tool.needsApproval === "dynamic";
}

function isDangerousRisk(risk: unknown): boolean {
  return risk === "write" || risk === "external" || risk === "destructive";
}

function hasAgentStepLimit(agent: AgentRecord): boolean {
  if (typeof agent.maxSteps === "number" && agent.maxSteps > 0) {
    return true;
  }
  const stopWhen = agent.stopWhen;
  return Boolean(
    stopWhen &&
      typeof stopWhen === "object" &&
      "maxSteps" in stopWhen &&
      typeof (stopWhen as { maxSteps?: unknown }).maxSteps === "number" &&
      (stopWhen as { maxSteps: number }).maxSteps > 0,
  );
}

function runAgentRedteam(workspaceRoot: string): AiCommandResult {
  const agentTools = loadAgentTools(workspaceRoot);
  const explicitTools = (agentTools?.explicitTools ?? []) as AgentToolRecord[];
  const autoTools = (agentTools?.autoTools ?? []) as AgentToolRecord[];
  const agents = (agentTools?.agents ?? []) as AgentRecord[];
  const allTools = [...explicitTools, ...autoTools];
  const dangerousTools = allTools.filter((tool) => isDangerousRisk(tool.risk));
  const dangerousWithoutApproval = dangerousTools.filter((tool) => !toolNeedsApproval(tool));
  const readToolsWithWriteSurface = allTools.filter(
    (tool) => tool.risk === "read" && tool.readOnly === false,
  );
  const commandToolsWithoutApproval = autoTools.filter(
    (tool) => tool.sourceKind === "command" && !toolNeedsApproval(tool),
  );
  const agentsWithoutStepLimit = agents.filter((agent) => !hasAgentStepLimit(agent));
  const secretLikeTools = allTools.filter((tool) => /secret|token|api[_-]?key/i.test(toolName(tool)));

  const scenarios: AiRedteamScenario[] = [
    {
      id: "approval-bypass",
      name: "Dangerous tools require approval",
      status:
        dangerousTools.length === 0
          ? "not-applicable"
          : dangerousWithoutApproval.length === 0
            ? "passed"
            : "failed",
      evidence:
        dangerousWithoutApproval.length === 0
          ? `${dangerousTools.length} dangerous tools require approval`
          : `tools without approval: ${dangerousWithoutApproval.map(toolName).sort().join(", ")}`,
    },
    {
      id: "auto-command-approval",
      name: "Generated command auto-tools require approval",
      status:
        autoTools.filter((tool) => tool.sourceKind === "command").length === 0
          ? "not-applicable"
          : commandToolsWithoutApproval.length === 0
            ? "passed"
            : "failed",
      evidence:
        commandToolsWithoutApproval.length === 0
          ? "command auto-tools are approval gated"
          : `command auto-tools without approval: ${commandToolsWithoutApproval.map(toolName).sort().join(", ")}`,
    },
    {
      id: "read-only-boundary",
      name: "Read tools stay read-only",
      status: readToolsWithWriteSurface.length === 0 ? "passed" : "failed",
      evidence:
        readToolsWithWriteSurface.length === 0
          ? "read tools do not expose write metadata"
          : `read tools with write surface: ${readToolsWithWriteSurface.map(toolName).sort().join(", ")}`,
    },
    {
      id: "excessive-agency",
      name: "Agents have bounded step limits",
      status:
        agents.length === 0
          ? "not-applicable"
          : agentsWithoutStepLimit.length === 0
            ? "passed"
            : "failed",
      evidence:
        agentsWithoutStepLimit.length === 0
          ? `${agents.length} agents are step bounded`
          : `agents without step limits: ${agentsWithoutStepLimit.map((agent) => String(agent.name ?? "<anonymous>")).sort().join(", ")}`,
    },
    {
      id: "secret-extraction-surface",
      name: "Tool names do not expose secret-like capabilities",
      status: secretLikeTools.length === 0 ? "passed" : "failed",
      evidence:
        secretLikeTools.length === 0
          ? "no secret-like tool names detected"
          : `secret-like tools: ${secretLikeTools.map(toolName).sort().join(", ")}`,
    },
  ];

  const failed = scenarios.filter((scenario) => scenario.status === "failed");
  return {
    exitCode: failed.length === 0 ? 0 : 1,
    data: {
      schemaVersion: "0.1.0",
      kind: "agent-redteam",
      ok: failed.length === 0,
      assurance: "structural-redteam",
      scenarios,
      summary: {
        passed: scenarios.filter((scenario) => scenario.status === "passed").map((scenario) => scenario.id),
        failed: failed.map((scenario) => scenario.id),
        notApplicable: scenarios
          .filter((scenario) => scenario.status === "not-applicable")
          .map((scenario) => scenario.id),
      },
    },
    diagnostics: failed.map((scenario) =>
      createDiagnostic({
        severity: "error",
        code: "FORGE_AI_REDTEAM_FAILED",
        message: `${scenario.name}: ${scenario.evidence}`,
        fixHint: "Review generated agentTools.json and require approval for write/external/destructive tools, read-only metadata for read tools, and max step limits for agents.",
        suggestedCommands: ["forge ai tools --json", "forge ai agents --json", "forge ai redteam --json"],
        docs: ["docs/ai-agents.md", "docs/threat-model.md"],
      }),
    ),
  };
}

export function summarizeAiTrace(traceId: string, inspected: {
  events: Record<string, unknown>[];
  spans: Record<string, unknown>[];
}): AiTraceSummary {
  const aiEvents = inspected.events
    .map((event) => {
      const payload = payloadOf(event);
      const name = eventName(payload);
      return {
        id: event.id,
        name,
        status: event.status,
        createdAt: event.created_at,
        properties: eventProperties(payload),
      };
    })
    .filter((event) => event.name.startsWith("forge.ai."));

  const bySuffix = (suffix: string) => aiEvents.filter((event) => event.name.endsWith(suffix));
  return {
    traceId,
    agents: aiEvents.filter((event) => event.name.startsWith("forge.ai.agent.")),
    tools: aiEvents.filter((event) => event.name.startsWith("forge.ai.tool.")),
    generations: aiEvents.filter((event) => event.name.startsWith("forge.ai.generation.") || event.name.startsWith("forge.ai.stream.")),
    usage: aiEvents.filter((event) => event.name === "forge.ai.usage"),
    failures: [...bySuffix(".failed")],
    events: aiEvents,
    spans: inspected.spans,
  };
}

export async function runAiCommand(options: AiCommandOptions): Promise<AiCommandResult> {
  initializeRuntimeEnv(options.workspaceRoot);
  const registry = loadAiRegistry(options.workspaceRoot);
  const secretRegistry = loadSecretRegistry(options.workspaceRoot);
  const store = getRuntimeEnvStore(options.workspaceRoot);

  switch (options.subcommand) {
    case "providers": {
      const providers = registry?.providers ?? loadAiProviders(options.workspaceRoot);
      return { exitCode: 0, data: { providers } };
    }
    case "models": {
      const models = loadAiModels(options.workspaceRoot);
      return { exitCode: 0, data: { models } };
    }
    case "tools": {
      const agentTools = loadAgentTools(options.workspaceRoot);
      return {
        exitCode: 0,
        data: {
          explicitTools: agentTools?.explicitTools ?? registry?.tools ?? [],
          autoTools: agentTools?.autoTools ?? [],
        },
      };
    }
    case "agents": {
      const agentTools = loadAgentTools(options.workspaceRoot);
      return { exitCode: 0, data: { agents: agentTools?.agents ?? registry?.agents ?? [] } };
    }
    case "redteam": {
      return runAgentRedteam(options.workspaceRoot);
    }
    case "trace": {
      if (!options.traceId) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_CLI_USAGE",
              message: "forge ai trace requires a trace id",
            }),
          ],
        };
      }
      const { adapter, diagnostics } = await createDbAdapter({
        kind: options.db ?? "pglite",
        workspaceRoot: options.workspaceRoot,
        databaseUrl: options.databaseUrl,
      });
      if (!adapter) {
        return { exitCode: 1, diagnostics };
      }
      try {
        const sqlPlan = readGeneratedJson<SqlPlan>(
          options.workspaceRoot,
          `${GENERATED_DIR}/sqlPlan.json`,
        );
        if (sqlPlan) {
          await applyMigrations(adapter, sqlPlan);
        }
        const inspected = await inspectTrace(adapter, options.traceId);
        return { exitCode: 0, data: summarizeAiTrace(options.traceId, inspected) };
      } finally {
        await adapter.close();
      }
    }
    case "check": {
      const result = checkAiProviders(store, registry, secretRegistry);
      return { exitCode: result.ok ? 0 : 1, data: result };
    }
    case "test": {
      if (!options.provider || !options.model || !options.prompt) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_CLI_USAGE",
              message:
                "forge ai test requires --provider, --model, and --prompt",
            }),
          ],
        };
      }

      if (options.mock) {
        enqueueMockAiResponse({
          text: `mock:${options.prompt}`,
          usage: { promptTokens: 5, completionTokens: 10, totalTokens: 15 },
        });
      }

      const bundle = createRuntimeSecretsBundle({
        store,
        registry: secretRegistry,
        envSchema: null,
        runtimeKind: "server",
      });
      const telemetry = createNoopTelemetryContext(generateTraceId());
      const ai = createAiContext({
        secrets: bundle.secrets,
        telemetry,
        runtimeKind: "server",
        mockAi: options.mock,
      });

      try {
        const result = await ai.generateText({
          provider: options.provider,
          model: options.model,
          prompt: options.prompt,
          purpose: "cli_test",
        });
        return { exitCode: 0, data: result };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_AI_GENERATION_FAILED",
              message,
            }),
          ],
        };
      }
    }
    default:
      return { exitCode: 1 };
  }
}

export function formatAiJson(result: AiCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAiHuman(subcommand: AiSubcommand, result: AiCommandResult): string {
  if (result.diagnostics?.length) {
    return `${result.diagnostics.map((d) => d.message).join("\n")}\n`;
  }

  if (subcommand === "providers") {
    const providers = (result.data as { providers: unknown[] })?.providers ?? [];
    return `${providers.map((p) => JSON.stringify(p)).join("\n")}\n`;
  }

  if (subcommand === "models") {
    const models = (result.data as { models: unknown[] })?.models ?? [];
    return `${models.map((m) => JSON.stringify(m)).join("\n")}\n`;
  }

  if (subcommand === "tools") {
    const data = result.data as { explicitTools?: unknown[]; autoTools?: unknown[] };
    const tools = [
      ...(data.explicitTools ?? []),
      ...(data.autoTools ?? []),
    ];
    return `${tools.map((m) => JSON.stringify(m)).join("\n")}\n`;
  }

  if (subcommand === "agents") {
    const agents = (result.data as { agents: unknown[] })?.agents ?? [];
    return `${agents.map((m) => JSON.stringify(m)).join("\n")}\n`;
  }

  if (subcommand === "trace") {
    return `${JSON.stringify(result.data, null, 2)}\n`;
  }

  if (subcommand === "redteam") {
    return `${JSON.stringify(result.data, null, 2)}\n`;
  }

  if (subcommand === "check") {
    const data = result.data as { ok: boolean; missing: string[] };
    return data.ok
      ? "AI providers configured\n"
      : `missing secrets: ${data.missing.join(", ")}\n`;
  }

  if (subcommand === "test") {
    return `${JSON.stringify(result.data, null, 2)}\n`;
  }

  return "\n";
}
