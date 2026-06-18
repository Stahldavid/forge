import { scrubEnvelopePayload } from "../runtime/telemetry/scrubber.ts";

const SECRET_KEY_PATTERN = /password|secret|token|apikey|apiKey|api_key|authorization|cookie/i;

export interface DeltaRedactionResult<T> {
  value: T;
  redaction: {
    diagnostics: string[];
    redacted: boolean;
  };
}

function collectSecretLikeKeys(value: unknown, path: string[] = [], keys: string[] = []): string[] {
  if (!value || typeof value !== "object") {
    return keys;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretLikeKeys(item, [...path, String(index)], keys));
    return keys;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = [...path, key];
    if (SECRET_KEY_PATTERN.test(key)) {
      keys.push(next.join("."));
    }
    collectSecretLikeKeys(child, next, keys);
  }
  return keys;
}

export function redactDeltaPayload<T extends Record<string, unknown>>(
  value: T,
  options: { secretValues?: string[] } = {},
): DeltaRedactionResult<T> {
  const secretKeys = collectSecretLikeKeys(value);
  const scrubbed = scrubEnvelopePayload(value, {
    secretValues: options.secretValues,
  });
  return {
    value: scrubbed.value,
    redaction: {
      diagnostics: [
        ...secretKeys.map((key) => `redacted secret-like key ${key}`),
        ...scrubbed.diagnostics.map((diagnostic) => diagnostic.message),
      ],
      redacted: secretKeys.length > 0 || scrubbed.diagnostics.length > 0,
    },
  };
}

