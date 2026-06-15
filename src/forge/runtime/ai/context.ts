import type { RuntimeContext } from "../../compiler/types/runtime.ts";
import {
  FORGE_AI_FORBIDDEN_CONTEXT,
  FORGE_AI_GENERATION_FAILED,
} from "../../compiler/diagnostics/codes.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import type { SecretsContext } from "../secrets/types.ts";
import { estimateCostUsd } from "./cost-estimator.ts";
import { createMockAiUsage, dequeueMockAiResponse } from "./mock.ts";
import { resolveLanguageModel } from "./providers.ts";
import { isMockAiEnabled } from "./state.ts";
import type {
  AiContext,
  AiTelemetryEnvelope,
  ForgeGenerateStructuredInput,
  ForgeGenerateTextInput,
  ForgeGenerateTextResult,
  ForgeRunAgentInput,
  ForgeRunAgentResult,
  ForgeStreamTextInput,
  ForgeStreamTextResult,
  ForgeAiUsage,
} from "./types.ts";

const AI_ALLOWED_CONTEXTS: RuntimeContext[] = [
  "server",
  "action",
  "workflow",
  "endpoint",
  "test",
  "build",
];

function forgeError(code: string, message: string): never {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  throw error;
}

function mapUsage(usage: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}): ForgeAiUsage {
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}

async function recordAiTelemetry(
  telemetry: TelemetryContext | undefined,
  event: string,
  properties: Record<string, unknown>,
): Promise<void> {
  if (!telemetry) return;
  await telemetry.capture(event, properties);
}

export interface CreateAiContextOptions {
  secrets: SecretsContext;
  telemetry?: TelemetryContext;
  runtimeKind: RuntimeContext;
  envelope?: AiTelemetryEnvelope;
  mockAi?: boolean;
  toolContext?: {
    env?: Record<string, string | undefined>;
    auth?: unknown;
  };
}

export function aiForbiddenInContext(runtimeKind: RuntimeContext): boolean {
  return !AI_ALLOWED_CONTEXTS.includes(runtimeKind);
}

export function createAiContext(options: CreateAiContextOptions): AiContext {
  const { secrets, telemetry, runtimeKind, envelope, mockAi } = options;
  const useMock = isMockAiEnabled({ mockAi });

  if (aiForbiddenInContext(runtimeKind)) {
    return {
      async generateText() {
        forgeError(
          FORGE_AI_FORBIDDEN_CONTEXT,
          `ctx.ai is forbidden in '${runtimeKind}' context`,
        );
      },
      async streamText() {
        forgeError(
          FORGE_AI_FORBIDDEN_CONTEXT,
          `ctx.ai is forbidden in '${runtimeKind}' context`,
        );
      },
      async generateStructured() {
        forgeError(
          FORGE_AI_FORBIDDEN_CONTEXT,
          `ctx.ai is forbidden in '${runtimeKind}' context`,
        );
      },
      async runAgent() {
        forgeError(
          FORGE_AI_FORBIDDEN_CONTEXT,
          `ctx.ai is forbidden in '${runtimeKind}' context`,
        );
      },
    };
  }

  const baseProps = () => ({
    traceId: envelope?.traceId ?? telemetry?.traceId,
    workflowRunId: envelope?.workflowRunId,
    workflowStepId: envelope?.workflowStepId,
    actionRunId: envelope?.actionRunId,
    tenantId: envelope?.tenantId,
    userId: envelope?.userId,
  });

  return {
    async generateText(input: ForgeGenerateTextInput): Promise<ForgeGenerateTextResult> {
      const startedAt = Date.now();
      await recordAiTelemetry(telemetry, "forge.ai.generation.started", {
        ...baseProps(),
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        method: "generateText",
      });

      try {
        if (useMock) {
          const mock = dequeueMockAiResponse();
          const usage = createMockAiUsage(mock.usage);
          const latencyMs = Date.now() - startedAt;
          const estimatedCostUsd = estimateCostUsd(input.provider, input.model, usage);

          await recordAiTelemetry(telemetry, "forge.ai.generation.completed", {
            ...baseProps(),
            provider: input.provider,
            model: input.model,
            purpose: input.purpose,
            latencyMs,
            usage,
            estimatedCostUsd,
            status: "completed",
            mode: "mock",
          });
          await recordAiTelemetry(telemetry, "forge.ai.usage", {
            ...baseProps(),
            provider: input.provider,
            model: input.model,
            usage,
            estimatedCostUsd,
          });

          return {
            text: mock.text,
            provider: input.provider,
            model: input.model,
            purpose: input.purpose,
            usage,
            latencyMs,
            estimatedCostUsd,
          };
        }

        const languageModel = await resolveLanguageModel(
          input.provider,
          input.model,
          secrets,
        );
        const { generateText } = await import("ai");
        const result = await generateText({
          model: languageModel,
          prompt: input.prompt,
          system: input.system,
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
        });

        const usage = mapUsage(result.usage);
        const latencyMs = Date.now() - startedAt;
        const estimatedCostUsd = estimateCostUsd(input.provider, input.model, usage);

        await recordAiTelemetry(telemetry, "forge.ai.generation.completed", {
          ...baseProps(),
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          latencyMs,
          usage,
          estimatedCostUsd,
          status: "completed",
        });
        await recordAiTelemetry(telemetry, "forge.ai.usage", {
          ...baseProps(),
          provider: input.provider,
          model: input.model,
          usage,
          estimatedCostUsd,
        });

        return {
          text: result.text,
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          usage,
          latencyMs,
          estimatedCostUsd,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error instanceof Error && "code" in error
            ? String((error as Error & { code: string }).code)
            : FORGE_AI_GENERATION_FAILED;

        await recordAiTelemetry(telemetry, "forge.ai.generation.failed", {
          ...baseProps(),
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          status: "failed",
          error: message,
          code,
        });

        if (code === FORGE_AI_GENERATION_FAILED) {
          forgeError(FORGE_AI_GENERATION_FAILED, message);
        }
        throw error;
      }
    },

    async streamText(input: ForgeStreamTextInput): Promise<ForgeStreamTextResult> {
      const startedAt = Date.now();
      await recordAiTelemetry(telemetry, "forge.ai.stream.started", {
        ...baseProps(),
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
      });

      if (useMock) {
        const mock = dequeueMockAiResponse();
        const usage = createMockAiUsage(mock.usage);
        const latencyMs = Date.now() - startedAt;

        async function* mockStream() {
          yield mock.text;
        }

        const textPromise = Promise.resolve(mock.text).then(async (text) => {
          await recordAiTelemetry(telemetry, "forge.ai.stream.completed", {
            ...baseProps(),
            provider: input.provider,
            model: input.model,
            purpose: input.purpose,
            latencyMs,
            usage,
            status: "completed",
            mode: "mock",
          });
          return text;
        });

        return {
          textStream: mockStream(),
          text: textPromise,
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          usage: Promise.resolve(usage),
          latencyMs,
        };
      }

      const languageModel = await resolveLanguageModel(
        input.provider,
        input.model,
        secrets,
      );
      const { streamText } = await import("ai");
      const result = streamText({
        model: languageModel,
        prompt: input.prompt,
        system: input.system,
        temperature: input.temperature,
        maxOutputTokens: input.maxTokens,
      });

      const latencyMs = Date.now() - startedAt;

      return {
        textStream: result.textStream,
        text: Promise.resolve(result.text).then(async (text) => {
          const usage = mapUsage(await result.usage);
          await recordAiTelemetry(telemetry, "forge.ai.stream.completed", {
            ...baseProps(),
            provider: input.provider,
            model: input.model,
            purpose: input.purpose,
            latencyMs: Date.now() - startedAt,
            usage,
            status: "completed",
          });
          return text;
        }),
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        usage: Promise.resolve(result.usage).then(mapUsage),
        latencyMs,
      };
    },

    async generateStructured<T>(input: ForgeGenerateStructuredInput<T>): Promise<T> {
      const startedAt = Date.now();
      await recordAiTelemetry(telemetry, "forge.ai.generation.started", {
        ...baseProps(),
        provider: input.provider,
        model: input.model,
        purpose: input.purpose,
        method: "generateStructured",
      });

      try {
        if (useMock) {
          const mock = dequeueMockAiResponse();
          let parsed: T;
          try {
            parsed = JSON.parse(mock.text) as T;
          } catch {
            parsed = { text: mock.text } as T;
          }

          const usage = createMockAiUsage(mock.usage);
          await recordAiTelemetry(telemetry, "forge.ai.generation.completed", {
            ...baseProps(),
            provider: input.provider,
            model: input.model,
            purpose: input.purpose,
            latencyMs: Date.now() - startedAt,
            usage,
            status: "completed",
            mode: "mock",
            method: "generateStructured",
          });
          return parsed;
        }

        const languageModel = await resolveLanguageModel(
          input.provider,
          input.model,
          secrets,
        );
        const { generateText, Output } = await import("ai");
        const result = await generateText({
          model: languageModel as never,
          prompt: input.prompt,
          system: input.system,
          output: Output.object({ schema: input.schema as never }),
        });

        const usage = mapUsage(result.usage);
        await recordAiTelemetry(telemetry, "forge.ai.generation.completed", {
          ...baseProps(),
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          latencyMs: Date.now() - startedAt,
          usage,
          status: "completed",
          method: "generateStructured",
        });

        return result.output as T;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordAiTelemetry(telemetry, "forge.ai.generation.failed", {
          ...baseProps(),
          provider: input.provider,
          model: input.model,
          purpose: input.purpose,
          status: "failed",
          error: message,
        });
        throw error;
      }
    },

    async runAgent(input: ForgeRunAgentInput): Promise<ForgeRunAgentResult> {
      const provider = input.provider ?? "gateway";
      const startedAt = Date.now();
      await recordAiTelemetry(telemetry, "forge.ai.agent.started", {
        ...baseProps(),
        provider,
        model: input.model,
        purpose: input.purpose,
        toolCount: Object.keys(input.tools ?? {}).length,
      });

      try {
        if (useMock) {
          const mock = dequeueMockAiResponse();
          const usage = createMockAiUsage(mock.usage);
          const latencyMs = Date.now() - startedAt;
          const estimatedCostUsd = estimateCostUsd(provider, input.model, usage);
          const result = {
            text: mock.text,
            provider,
            model: input.model,
            purpose: input.purpose,
            usage,
            latencyMs,
            toolCalls: [],
            toolResults: [],
            steps: 1,
            estimatedCostUsd,
          };
          await recordAiTelemetry(telemetry, "forge.ai.agent.completed", {
            ...baseProps(),
            provider,
            model: input.model,
            purpose: input.purpose,
            latencyMs,
            usage,
            estimatedCostUsd,
            status: "completed",
            mode: "mock",
          });
          return result;
        }

        const languageModel = await resolveLanguageModel(provider, input.model, secrets);
        const { ToolLoopAgent, hasToolCall, stepCountIs, tool } = await import("ai");
        const toolRuntimeContext = {
          secrets,
          env: options.toolContext?.env ?? {},
          telemetry,
          auth: options.toolContext?.auth,
        };

        const tools = Object.fromEntries(
          Object.entries(input.tools ?? {}).map(([name, definition]) => {
            const needsApproval = definition.needsApproval;
            const aiSdkToolConfig = {
              description: definition.description,
              inputSchema: definition.inputSchema as never,
              ...(definition.outputSchema
                ? { outputSchema: definition.outputSchema as never }
                : {}),
              ...(definition.strict !== undefined ? { strict: definition.strict } : {}),
              ...(needsApproval !== undefined
                ? {
                    needsApproval:
                      typeof needsApproval === "function"
                        ? async ({ args }: { args: unknown }) =>
                            Boolean(await needsApproval(args as never))
                        : needsApproval,
                  }
                : {}),
              execute: async (args: unknown) => {
                await recordAiTelemetry(telemetry, "forge.ai.tool.started", {
                  ...baseProps(),
                  provider,
                  model: input.model,
                  purpose: input.purpose,
                  tool: name,
                  risk: definition.risk ?? "external",
                });
                const toolStartedAt = Date.now();
                try {
                  const output = await definition.handler(
                    toolRuntimeContext,
                    args as never,
                  );
                  await recordAiTelemetry(telemetry, "forge.ai.tool.completed", {
                    ...baseProps(),
                    provider,
                    model: input.model,
                    purpose: input.purpose,
                    tool: name,
                    latencyMs: Date.now() - toolStartedAt,
                    status: "completed",
                  });
                  return output;
                } catch (error) {
                  await recordAiTelemetry(telemetry, "forge.ai.tool.failed", {
                    ...baseProps(),
                    provider,
                    model: input.model,
                    purpose: input.purpose,
                    tool: name,
                    latencyMs: Date.now() - toolStartedAt,
                    status: "failed",
                    error: error instanceof Error ? error.message : String(error),
                  });
                  throw error;
                }
              },
            };
            return [name, tool(aiSdkToolConfig as never)];
          }),
        );

        const stopWhen =
          input.stopWhen?.kind === "toolCall"
            ? hasToolCall(input.stopWhen.toolName)
            : stepCountIs(input.stopWhen?.maxSteps ?? input.maxSteps ?? 20);

        const agent = new ToolLoopAgent({
          model: languageModel as never,
          instructions: input.instructions,
          tools,
          stopWhen,
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
        });

        const result = await agent.generate({ prompt: input.prompt });
        const usage = mapUsage(result.usage);
        const latencyMs = Date.now() - startedAt;
        const estimatedCostUsd = estimateCostUsd(provider, input.model, usage);
        const raw = result as unknown as {
          steps?: unknown[];
          toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }>;
          toolResults?: Array<{ toolName?: string; output?: unknown; result?: unknown }>;
        };

        await recordAiTelemetry(telemetry, "forge.ai.agent.completed", {
          ...baseProps(),
          provider,
          model: input.model,
          purpose: input.purpose,
          latencyMs,
          usage,
          estimatedCostUsd,
          status: "completed",
          steps: raw.steps?.length ?? 1,
        });
        await recordAiTelemetry(telemetry, "forge.ai.usage", {
          ...baseProps(),
          provider,
          model: input.model,
          purpose: input.purpose,
          usage,
          estimatedCostUsd,
          method: "runAgent",
        });

        return {
          text: result.text,
          provider,
          model: input.model,
          purpose: input.purpose,
          usage,
          latencyMs,
          toolCalls: (raw.toolCalls ?? []).map((call) => ({
            toolName: call.toolName ?? "unknown",
            input: call.input ?? call.args,
          })),
          toolResults: (raw.toolResults ?? []).map((toolResult) => ({
            toolName: toolResult.toolName ?? "unknown",
            output: toolResult.output ?? toolResult.result,
          })),
          steps: raw.steps?.length ?? 1,
          estimatedCostUsd,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await recordAiTelemetry(telemetry, "forge.ai.agent.failed", {
          ...baseProps(),
          provider,
          model: input.model,
          purpose: input.purpose,
          status: "failed",
          error: message,
        });
        throw error;
      }
    },
  };
}

export function createNoopAiContext(): AiContext {
  const noop = async () => {
    throw new Error("AI context unavailable");
  };
  return {
    generateText: noop,
    streamText: noop,
    generateStructured: noop,
    runAgent: noop,
  };
}
