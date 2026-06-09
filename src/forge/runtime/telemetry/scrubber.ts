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

function redactValue(key: string, value: unknown, diagnostics: Diagnostic[]): unknown {
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
    return scrubObject(value as Record<string, unknown>, diagnostics);
  }

  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValue(String(index), item, diagnostics),
    );
  }

  return value;
}

function scrubObject(
  obj: Record<string, unknown>,
  diagnostics: Diagnostic[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = redactValue(key, value, diagnostics);
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
): ScrubResult<T> {
  const diagnostics: Diagnostic[] = [];
  const scrubbed = scrubObject(payload, diagnostics) as T;

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
