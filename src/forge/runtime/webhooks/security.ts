import { createHmac, timingSafeEqual } from "node:crypto";
import type { DiagnosticCode } from "../../compiler/diagnostics/codes.ts";
import {
  FORGE_WEBHOOK_REPLAY_DETECTED,
  FORGE_WEBHOOK_SIGNATURE_INVALID,
  FORGE_WEBHOOK_TIMESTAMP_INVALID,
} from "../../compiler/diagnostics/codes.ts";

export type WebhookProvider = "generic" | "github" | "stripe";

export interface WebhookReplayStore {
  has(eventId: string): boolean | Promise<boolean>;
  add(eventId: string): void | Promise<void>;
}

export interface WebhookVerificationInput {
  provider: WebhookProvider;
  secret: string;
  payload: string | Uint8Array;
  signatureHeader: string | null | undefined;
  timestampHeader?: string | null;
  eventId?: string;
  replayStore?: WebhookReplayStore;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export interface WebhookVerificationResult {
  ok: boolean;
  code?: DiagnosticCode;
  reason?: string;
  provider: WebhookProvider;
}

export class MemoryWebhookReplayStore implements WebhookReplayStore {
  private readonly seen = new Set<string>();

  has(eventId: string): boolean {
    return this.seen.has(eventId);
  }

  add(eventId: string): void {
    this.seen.add(eventId);
  }
}

function bytes(input: string | Uint8Array): Uint8Array {
  return typeof input === "string" ? Buffer.from(input, "utf8") : input;
}

function hmacHex(secret: string, payload: string | Uint8Array): string {
  return createHmac("sha256", secret).update(bytes(payload)).digest("hex");
}

function safeEqualHex(left: string | undefined, right: string): boolean {
  if (!left || !/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function fail(
  provider: WebhookProvider,
  code: DiagnosticCode,
  reason: string,
): WebhookVerificationResult {
  return { ok: false, provider, code, reason };
}

function parseStripeHeader(header: string): { timestamp?: number; signatures: string[] } {
  const signatures: string[] = [];
  let timestamp: number | undefined;
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((item) => item.trim());
    if (key === "t") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        timestamp = parsed;
      }
    }
    if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  return { timestamp, signatures };
}

function validateTimestamp(input: {
  provider: WebhookProvider;
  timestamp?: number;
  nowSeconds: number;
  toleranceSeconds: number;
}): WebhookVerificationResult | null {
  if (!Number.isFinite(input.timestamp)) {
    return fail(input.provider, FORGE_WEBHOOK_TIMESTAMP_INVALID, "missing or invalid webhook timestamp");
  }
  if (Math.abs(input.nowSeconds - input.timestamp!) > input.toleranceSeconds) {
    return fail(input.provider, FORGE_WEBHOOK_TIMESTAMP_INVALID, "webhook timestamp is outside the replay window");
  }
  return null;
}

async function validateReplay(input: {
  provider: WebhookProvider;
  eventId?: string;
  replayStore?: WebhookReplayStore;
}): Promise<WebhookVerificationResult | null> {
  if (!input.eventId || !input.replayStore) {
    return null;
  }
  if (await input.replayStore.has(input.eventId)) {
    return fail(input.provider, FORGE_WEBHOOK_REPLAY_DETECTED, "webhook event id was already processed");
  }
  await input.replayStore.add(input.eventId);
  return null;
}

export async function verifyWebhookSignature(
  input: WebhookVerificationInput,
): Promise<WebhookVerificationResult> {
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const signatureHeader = input.signatureHeader ?? "";

  if (!input.secret || !signatureHeader) {
    return fail(input.provider, FORGE_WEBHOOK_SIGNATURE_INVALID, "missing webhook secret or signature");
  }

  let valid = false;
  let timestamp: number | undefined;

  if (input.provider === "stripe") {
    const parsed = parseStripeHeader(signatureHeader);
    timestamp = parsed.timestamp;
    const timestampFailure = validateTimestamp({
      provider: input.provider,
      timestamp,
      nowSeconds,
      toleranceSeconds,
    });
    if (timestampFailure) {
      return timestampFailure;
    }
    const signedPayload = `${timestamp}.${Buffer.from(bytes(input.payload)).toString("utf8")}`;
    const expected = hmacHex(input.secret, signedPayload);
    valid = parsed.signatures.some((signature) => safeEqualHex(signature, expected));
  } else if (input.provider === "github") {
    const provided = signatureHeader.startsWith("sha256=")
      ? signatureHeader.slice("sha256=".length)
      : signatureHeader;
    valid = safeEqualHex(provided, hmacHex(input.secret, input.payload));
  } else {
    const timestampRaw = input.timestampHeader ?? undefined;
    timestamp = timestampRaw === undefined ? undefined : Number(timestampRaw);
    if (timestampRaw !== undefined) {
      const timestampFailure = validateTimestamp({
        provider: input.provider,
        timestamp,
        nowSeconds,
        toleranceSeconds,
      });
      if (timestampFailure) {
        return timestampFailure;
      }
    }
    const signedPayload = timestampRaw === undefined
      ? input.payload
      : `${timestampRaw}.${Buffer.from(bytes(input.payload)).toString("utf8")}`;
    valid = safeEqualHex(signatureHeader, hmacHex(input.secret, signedPayload));
  }

  if (!valid) {
    return fail(input.provider, FORGE_WEBHOOK_SIGNATURE_INVALID, "webhook signature did not match payload");
  }

  const replayFailure = await validateReplay(input);
  if (replayFailure) {
    return replayFailure;
  }

  return { ok: true, provider: input.provider };
}
