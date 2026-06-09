import type { LanguageModel } from "ai";
import {
  FORGE_AI_MODEL_MISSING,
  FORGE_AI_PROVIDER_UNKNOWN,
  FORGE_AI_SECRET_MISSING,
} from "../../compiler/diagnostics/codes.ts";
import type { SecretsContext } from "../secrets/types.ts";
import type { ForgeAiProvider } from "./types.ts";

function forgeError(code: string, message: string): never {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  throw error;
}

const PROVIDER_SECRETS: Record<ForgeAiProvider, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gateway: "AI_GATEWAY_API_KEY",
};

export function resolveProviderSecret(provider: ForgeAiProvider): string {
  return PROVIDER_SECRETS[provider];
}

export async function resolveLanguageModel(
  provider: ForgeAiProvider,
  model: string,
  secrets: SecretsContext,
): Promise<LanguageModel> {
  if (!model || model.trim().length === 0) {
    forgeError(FORGE_AI_MODEL_MISSING, "AI model is required");
  }

  switch (provider) {
    case "openai": {
      const apiKey = secrets.optional(PROVIDER_SECRETS.openai);
      if (!apiKey) {
        forgeError(
          FORGE_AI_SECRET_MISSING,
          `required secret '${PROVIDER_SECRETS.openai}' is not set for openai provider`,
        );
      }
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({ apiKey });
      return openai(model);
    }
    case "anthropic": {
      const apiKey = secrets.optional(PROVIDER_SECRETS.anthropic);
      if (!apiKey) {
        forgeError(
          FORGE_AI_SECRET_MISSING,
          `required secret '${PROVIDER_SECRETS.anthropic}' is not set for anthropic provider`,
        );
      }
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({ apiKey });
      return anthropic(model);
    }
    case "gateway": {
      const apiKey = secrets.optional(PROVIDER_SECRETS.gateway);
      if (!apiKey) {
        forgeError(
          FORGE_AI_SECRET_MISSING,
          `required secret '${PROVIDER_SECRETS.gateway}' is not set for gateway provider`,
        );
      }
      const { createGateway } = await import("ai");
      const gateway = createGateway({ apiKey });
      return gateway(model);
    }
    default:
      forgeError(
        FORGE_AI_PROVIDER_UNKNOWN,
        `unknown AI provider '${String(provider)}'`,
      );
  }
}
