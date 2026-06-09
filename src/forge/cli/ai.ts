import { createDiagnostic } from "../compiler/diagnostics/create.ts";
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
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import { createRuntimeSecretsBundle } from "../runtime/secrets/runtime-bundle.ts";
import type { ForgeAiProvider } from "../runtime/ai/types.ts";

export type AiSubcommand = "providers" | "check" | "test" | "models";

export interface AiCommandOptions {
  subcommand: AiSubcommand;
  workspaceRoot: string;
  json: boolean;
  provider?: ForgeAiProvider;
  model?: string;
  prompt?: string;
  mock?: boolean;
}

export interface AiCommandResult {
  exitCode: 0 | 1;
  data?: unknown;
  diagnostics?: ReturnType<typeof createDiagnostic>[];
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
