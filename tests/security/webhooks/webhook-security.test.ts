import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  FORGE_WEBHOOK_REPLAY_DETECTED,
  FORGE_WEBHOOK_SIGNATURE_INVALID,
  FORGE_WEBHOOK_TIMESTAMP_INVALID,
} from "../../../src/forge/compiler/diagnostics/codes.ts";
import {
  MemoryWebhookReplayStore,
  verifyWebhookSignature,
} from "../../../src/forge/runtime/webhooks/security.ts";

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("security assurance: webhook authenticity", () => {
  test("accepts valid Stripe signatures and rejects tampered payloads", async () => {
    const secret = "whsec_forge_test_secret";
    const payload = JSON.stringify({ id: "evt_forge_1", type: "invoice.paid" });
    const timestamp = 1_800_000_000;
    const signature = hmac(secret, `${timestamp}.${payload}`);

    const valid = await verifyWebhookSignature({
      provider: "stripe",
      secret,
      payload,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      nowSeconds: timestamp,
    });
    expect(valid.ok).toBe(true);

    const tampered = await verifyWebhookSignature({
      provider: "stripe",
      secret,
      payload: JSON.stringify({ id: "evt_forge_1", type: "invoice.refunded" }),
      signatureHeader: `t=${timestamp},v1=${signature}`,
      nowSeconds: timestamp,
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.code).toBe(FORGE_WEBHOOK_SIGNATURE_INVALID);
  });

  test("rejects old webhook timestamps", async () => {
    const secret = "whsec_forge_test_secret";
    const payload = "{}";
    const timestamp = 1_800_000_000;
    const signature = hmac(secret, `${timestamp}.${payload}`);

    const result = await verifyWebhookSignature({
      provider: "stripe",
      secret,
      payload,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      nowSeconds: timestamp + 1_000,
      toleranceSeconds: 300,
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(FORGE_WEBHOOK_TIMESTAMP_INVALID);
  });

  test("rejects replayed event ids after a valid signature", async () => {
    const store = new MemoryWebhookReplayStore();
    const secret = "whsec_forge_test_secret";
    const payload = "{}";
    const timestamp = 1_800_000_000;
    const signature = hmac(secret, `${timestamp}.${payload}`);

    const first = await verifyWebhookSignature({
      provider: "stripe",
      secret,
      payload,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      nowSeconds: timestamp,
      eventId: "evt_replayed",
      replayStore: store,
    });
    expect(first.ok).toBe(true);

    const second = await verifyWebhookSignature({
      provider: "stripe",
      secret,
      payload,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      nowSeconds: timestamp,
      eventId: "evt_replayed",
      replayStore: store,
    });
    expect(second.ok).toBe(false);
    expect(second.code).toBe(FORGE_WEBHOOK_REPLAY_DETECTED);
  });

  test("validates GitHub sha256 webhook signatures", async () => {
    const secret = "github-webhook-secret";
    const payload = JSON.stringify({ action: "opened" });
    const signature = hmac(secret, payload);

    const valid = await verifyWebhookSignature({
      provider: "github",
      secret,
      payload,
      signatureHeader: `sha256=${signature}`,
    });
    expect(valid.ok).toBe(true);

    const invalid = await verifyWebhookSignature({
      provider: "github",
      secret,
      payload,
      signatureHeader: "sha256=000000",
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe(FORGE_WEBHOOK_SIGNATURE_INVALID);
  });

  test("validates WorkOS webhook signatures with millisecond timestamps", async () => {
    const secret = "workos-webhook-secret";
    const payload = JSON.stringify({ id: "event_workos_1", event: "organization_membership.updated" });
    const timestampMs = 1_800_000_000_123;
    const signature = hmac(secret, `${timestampMs}.${payload}`);

    const valid = await verifyWebhookSignature({
      provider: "workos",
      secret,
      payload,
      signatureHeader: `t=${timestampMs},v1=${signature}`,
      nowSeconds: timestampMs / 1000,
      toleranceSeconds: 180,
    });
    expect(valid.ok).toBe(true);

    const stale = await verifyWebhookSignature({
      provider: "workos",
      secret,
      payload,
      signatureHeader: `t=${timestampMs},v1=${signature}`,
      nowSeconds: timestampMs / 1000 + 240,
      toleranceSeconds: 180,
    });
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe(FORGE_WEBHOOK_TIMESTAMP_INVALID);

    const tampered = await verifyWebhookSignature({
      provider: "workos",
      secret,
      payload: JSON.stringify({ id: "event_workos_1", event: "organization.deleted" }),
      signatureHeader: `t=${timestampMs},v1=${signature}`,
      nowSeconds: timestampMs / 1000,
      toleranceSeconds: 180,
    });
    expect(tampered.ok).toBe(false);
    expect(tampered.code).toBe(FORGE_WEBHOOK_SIGNATURE_INVALID);
  });
});
