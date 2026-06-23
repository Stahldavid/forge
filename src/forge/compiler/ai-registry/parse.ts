import type { ForgeAiProvider } from "../types/ai-registry.ts";

const AI_METHOD_PATTERN =
  /(?:(?:ctx\.ai|ai)\.(generateText|streamText|generateStructured|runAgent)|ctx\.agent\.(run))\s*\(/g;

const PROVIDER_PATTERN =
  /provider\s*:\s*["'](openai|anthropic|gateway)["']/;

const MODEL_PATTERN = /model\s*:\s*["']([^"']+)["']/;

const PURPOSE_PATTERN = /purpose\s*:\s*["']([^"']+)["']/;

export interface ParsedAiCall {
  method: "generateText" | "streamText" | "generateStructured" | "runAgent";
  provider?: ForgeAiProvider;
  model?: string;
  purpose?: string;
}

function quotedOrCommentRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < source.length && source[i] !== "\n") {
        i += 1;
      }
      ranges.push({ start, end: i });
      continue;
    }

    if (char === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(source.length, i + 2);
      ranges.push({ start, end: i });
      continue;
    }

    if (char === "\"" || char === "'" || char === "`") {
      const quote = char;
      const start = i;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      ranges.push({ start, end: i });
      continue;
    }

    i += 1;
  }

  return ranges;
}

function indexInsideRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

export function parseAiCallsFromSlice(sourceSlice: string): ParsedAiCall[] {
  const calls: ParsedAiCall[] = [];
  const ignoredRanges = quotedOrCommentRanges(sourceSlice);

  for (const match of sourceSlice.matchAll(AI_METHOD_PATTERN)) {
    const start = match.index ?? 0;
    if (indexInsideRange(start, ignoredRanges)) {
      continue;
    }

    const method = (match[1] ?? (match[2] ? "runAgent" : "")) as ParsedAiCall["method"];
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

const FORBIDDEN_AI_CONTEXT_PATTERN = /ctx\.(?:ai\.|agent\.run\s*\()/;

export function detectCtxAiUsage(sourceSlice: string): boolean {
  const ignoredRanges = quotedOrCommentRanges(sourceSlice);
  for (const match of sourceSlice.matchAll(new RegExp(FORBIDDEN_AI_CONTEXT_PATTERN, "g"))) {
    if (!indexInsideRange(match.index ?? 0, ignoredRanges)) {
      return true;
    }
  }
  return false;
}

const DESCRIPTION_PATTERN = /description\s*:\s*["'`]([^"'`]+)["'`]/;
const RISK_PATTERN = /risk\s*:\s*["'](read|write|external|destructive)["']/;
const STRICT_PATTERN = /strict\s*:\s*(true|false)/;
const NEEDS_APPROVAL_PATTERN = /needsApproval\s*:\s*(true|false|async\s*\(|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*)/;
const INSTRUCTIONS_PATTERN = /instructions\s*:\s*["'`]([^"'`]+)["'`]/;
const TOOL_ARRAY_PATTERN = /tools\s*:\s*\[([^\]]*)\]/s;
const TOOL_OBJECT_PATTERN = /tools\s*:\s*\{([^}]*)\}/s;
const STOP_TOOL_PATTERN = /stopWhen\s*:\s*\{[^}]*kind\s*:\s*["']toolCall["'][^}]*toolName\s*:\s*["']([^"']+)["'][^}]*\}/s;
const STOP_STEP_PATTERN = /stopWhen\s*:\s*\{[^}]*kind\s*:\s*["']stepCount["'][^}]*maxSteps\s*:\s*(\d+)[^}]*\}/s;
const MAX_STEPS_PATTERN = /maxSteps\s*:\s*(\d+)/;

export interface ParsedAiToolMeta {
  description?: string;
  risk: "read" | "write" | "external" | "destructive" | "unknown";
  strict: boolean;
  needsApproval: boolean | "dynamic";
}

export interface ParsedAiAgentMeta {
  provider?: ForgeAiProvider;
  model?: string;
  instructions?: string;
  tools: string[];
  stopWhen:
    | { kind: "stepCount"; maxSteps: number }
    | { kind: "toolCall"; toolName: string }
    | { kind: "default" };
}

function parseBooleanOrDynamic(value: string | undefined): boolean | "dynamic" {
  if (value === "true") return true;
  if (value === "false") return false;
  return "dynamic";
}

function parseStringList(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...raw.matchAll(/["'`]([^"'`]+)["'`]/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean)
    .sort();
}

function parseObjectToolKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  const explicit = [...raw.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)]
    .map((match) => match[1] ?? "")
    .filter(Boolean);
  const shorthand = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(part));
  return [...new Set([...explicit, ...shorthand])].sort();
}

export function parseAiToolMeta(sourceSlice: string): ParsedAiToolMeta {
  const description = DESCRIPTION_PATTERN.exec(sourceSlice)?.[1];
  const risk = RISK_PATTERN.exec(sourceSlice)?.[1] as ParsedAiToolMeta["risk"] | undefined;
  const strict = STRICT_PATTERN.exec(sourceSlice)?.[1] === "true";
  const needsApprovalMatch = NEEDS_APPROVAL_PATTERN.exec(sourceSlice)?.[1];

  return {
    ...(description ? { description } : {}),
    risk: risk ?? "unknown",
    strict,
    needsApproval: needsApprovalMatch
      ? parseBooleanOrDynamic(needsApprovalMatch)
      : false,
  };
}

export function parseAiAgentMeta(sourceSlice: string): ParsedAiAgentMeta {
  const provider = PROVIDER_PATTERN.exec(sourceSlice)?.[1] as ForgeAiProvider | undefined;
  const model = MODEL_PATTERN.exec(sourceSlice)?.[1];
  const instructions = INSTRUCTIONS_PATTERN.exec(sourceSlice)?.[1];
  const arrayTools = parseStringList(TOOL_ARRAY_PATTERN.exec(sourceSlice)?.[1]);
  const objectTools = parseObjectToolKeys(TOOL_OBJECT_PATTERN.exec(sourceSlice)?.[1]);
  const stopTool = STOP_TOOL_PATTERN.exec(sourceSlice)?.[1];
  const stopStepsRaw =
    STOP_STEP_PATTERN.exec(sourceSlice)?.[1] ?? MAX_STEPS_PATTERN.exec(sourceSlice)?.[1];

  return {
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(instructions ? { instructions } : {}),
    tools: [...new Set([...arrayTools, ...objectTools])].sort(),
    stopWhen: stopTool
      ? { kind: "toolCall", toolName: stopTool }
      : stopStepsRaw
        ? { kind: "stepCount", maxSteps: Number(stopStepsRaw) }
        : { kind: "default" },
  };
}
