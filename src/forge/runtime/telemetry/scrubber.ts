import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_TELEMETRY_PAYLOAD_TRUNCATED,
  FORGE_TELEMETRY_SECRET_REDACTED,
} from "../../compiler/diagnostics/codes.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";

const SECRET_KEY_PATTERN =
  /password|secret|token|apikey|authorization|cookie/i;

const MAX_PAYLOAD_BYTES = 8_192;
const MAX_STACK_BYTES = 4_096;

export interface ScrubResult<T> {
  value: T;
  diagnostics: Diagnostic[];
}

export interface ScrubOptions {
  secretValues?: string[];
}

function normalizeSecretValues(secretValues: string[] | undefined): string[] {
  return [...new Set((secretValues ?? []).filter((value) => value.length >= 8))]
    .sort((left, right) => right.length - left.length);
}

function redactKnownSecretString(
  key: string,
  value: string,
  diagnostics: Diagnostic[],
  secretValues: string[],
): string {
  let redacted = value;
  let didRedact = false;

  for (const secret of secretValues) {
    if (!redacted.includes(secret)) {
      continue;
    }
    redacted = redacted.split(secret).join("[REDACTED]");
    didRedact = true;
  }

  if (didRedact) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_TELEMETRY_SECRET_REDACTED,
        message: `redacted known secret value from telemetry field '${key}'`,
      }),
    );
  }

  return redacted;
}

function redactValue(
  key: string,
  value: unknown,
  diagnostics: Diagnostic[],
  secretValues: string[],
): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_TELEMETRY_SECRET_REDACTED,
        message: `redacted telemetry field '${key}'`,
      }),
    );
    return "[REDACTED]";
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return scrubObject(value as Record<string, unknown>, diagnostics, secretValues);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValue(String(index), item, diagnostics, secretValues),
    );
  }

  if (typeof value === "string" && secretValues.length > 0) {
    return redactKnownSecretString(key, value, diagnostics, secretValues);
  }

  return value;
}

function scrubObject(
  obj: Record<string, unknown>,
  diagnostics: Diagnostic[],
  secretValues: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = redactValue(key, value, diagnostics, secretValues);
  }
  return result;
}

function truncateString(
  value: string,
  maxBytes: number,
  diagnostics: Diagnostic[],
  field: string,
): string {
  const encoded = Buffer.byteLength(value, "utf8");
  if (encoded <= maxBytes) {
    return value;
  }

  diagnostics.push(
    createDiagnostic({
      severity: "warning",
      code: FORGE_TELEMETRY_PAYLOAD_TRUNCATED,
      message: `truncated telemetry ${field} from ${encoded} to ${maxBytes} bytes`,
    }),
  );

  let truncated = value;
  while (Buffer.byteLength(truncated, "utf8") > maxBytes && truncated.length > 0) {
    truncated = truncated.slice(0, Math.floor(truncated.length * 0.9));
  }
  return truncated;
}

export function scrubEnvelopePayload<T extends Record<string, unknown>>(
  payload: T,
  options: ScrubOptions = {},
): ScrubResult<T> {
  const diagnostics: Diagnostic[] = [];
  const secretValues = normalizeSecretValues(options.secretValues);
  const scrubbed = scrubObject(payload, diagnostics, secretValues) as T;

  if (typeof scrubbed.exception === "object" && scrubbed.exception !== null) {
    const exception = scrubbed.exception as Record<string, unknown>;
    if (typeof exception.stack === "string") {
      exception.stack = truncateString(
        exception.stack,
        MAX_STACK_BYTES,
        diagnostics,
        "stack",
      );
    }
  }

  const serialized = JSON.stringify(scrubbed);
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    diagnostics.push(
      createDiagnostic({
        severity: "warning",
        code: FORGE_TELEMETRY_PAYLOAD_TRUNCATED,
        message: `truncated telemetry payload to ${MAX_PAYLOAD_BYTES} bytes`,
      }),
    );
    const parsed = JSON.parse(
      truncateString(serialized, MAX_PAYLOAD_BYTES, diagnostics, "payload"),
    ) as T;
    return { value: parsed, diagnostics };
  }

  return { value: scrubbed, diagnostics };
}
