import type { ForgeAiProvider } from "../types/ai-registry.ts";

const AI_METHOD_PATTERN =
  /(?:ctx\.ai|ai)\.(generateText|streamText|generateStructured)\s*\(/g;

const PROVIDER_PATTERN =
  /provider\s*:\s*["'](openai|anthropic|gateway)["']/;

const MODEL_PATTERN = /model\s*:\s*["']([^"']+)["']/;

const PURPOSE_PATTERN = /purpose\s*:\s*["']([^"']+)["']/;

export interface ParsedAiCall {
  method: "generateText" | "streamText" | "generateStructured";
  provider?: ForgeAiProvider;
  model?: string;
  purpose?: string;
}

export function parseAiCallsFromSlice(sourceSlice: string): ParsedAiCall[] {
  const calls: ParsedAiCall[] = [];

  for (const match of sourceSlice.matchAll(AI_METHOD_PATTERN)) {
    const method = match[1] as ParsedAiCall["method"];
    const start = match.index ?? 0;
    const window = sourceSlice.slice(start, start + 600);

    let provider: ForgeAiProvider | undefined;
    const providerMatch = PROVIDER_PATTERN.exec(window);
    if (providerMatch?.[1]) {
      provider = providerMatch[1] as ForgeAiProvider;
    }

    let model: string | undefined;
    const modelMatch = MODEL_PATTERN.exec(window);
    if (modelMatch?.[1]) {
      model = modelMatch[1];
    }

    let purpose: string | undefined;
    const purposeMatch = PURPOSE_PATTERN.exec(window);
    if (purposeMatch?.[1]) {
      purpose = purposeMatch[1];
    }

    calls.push({ method, provider, model, purpose });
  }

  return calls;
}

const FORBIDDEN_AI_CONTEXT_PATTERN = /ctx\.ai\./;

export function detectCtxAiUsage(sourceSlice: string): boolean {
  return FORBIDDEN_AI_CONTEXT_PATTERN.test(sourceSlice);
}
