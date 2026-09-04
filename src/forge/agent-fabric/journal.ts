import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { ControlEventEnvelope, Digest, Identifier, UncommittedControlEvent } from "./types.ts";
import { validateControlEventEnvelope, validateUncommittedControlEvent } from "./validation.ts";

export interface AppendControlEventInput {
  expectedSequence: number;
  event: UncommittedControlEvent;
}

export interface ControlJournal {
  append(input: AppendControlEventInput): ControlEventEnvelope;
  readAll(): readonly ControlEventEnvelope[];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function eventDigestInput(envelope: Omit<ControlEventEnvelope, "eventDigest">): unknown {
  return envelope;
}

export class MemoryControlJournal implements ControlJournal {
  private readonly events: ControlEventEnvelope[] = [];
  private readonly byEventId = new Map<Identifier, ControlEventEnvelope>();
  private readonly byIdempotencyKey = new Map<Identifier, ControlEventEnvelope>();

  append(input: AppendControlEventInput): ControlEventEnvelope {
    validateUncommittedControlEvent(input.event);
    const incoming = structuredClone(input.event);
    const semanticFingerprint = stableStringify({
      eventId: incoming.eventId,
      rootExecutionId: incoming.rootExecutionId,
      payload: incoming.payload,
    });

    const existingByIdempotency = incoming.idempotencyKey
      ? this.byIdempotencyKey.get(incoming.idempotencyKey)
      : undefined;
    if (existingByIdempotency) {
      const existingFingerprint = stableStringify({
        eventId: existingByIdempotency.eventId,
        rootExecutionId: existingByIdempotency.rootExecutionId,
        payload: existingByIdempotency.payload,
      });
      if (semanticFingerprint !== existingFingerprint) {
        throw new AgentFabricError(
          "AF_CONFLICT",
          `Idempotency key ${incoming.idempotencyKey} was reused with different content`,
        );
      }
      return structuredClone(existingByIdempotency);
    }

    const existingById = this.byEventId.get(incoming.eventId);
    if (existingById) {
      const existingFingerprint = stableStringify({
        eventId: existingById.eventId,
        rootExecutionId: existingById.rootExecutionId,
        payload: existingById.payload,
      });
      if (semanticFingerprint !== existingFingerprint) {
        throw new AgentFabricError(
          "AF_DUPLICATE_ID",
          `Event ID ${incoming.eventId} was reused with different content`,
        );
      }
      return structuredClone(existingById);
    }

    if (input.expectedSequence !== this.events.length) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        "Control journal compare-and-swap failed",
        { actualSequence: this.events.length, expectedSequence: input.expectedSequence },
      );
    }

    const predecessor = this.events[this.events.length - 1];
    if (predecessor && incoming.occurredAt < predecessor.occurredAt) {
      throw new AgentFabricError(
        "AF_INVALID_EVENT",
        "Control journal timestamps must be monotonic",
        { occurredAt: incoming.occurredAt, predecessorOccurredAt: predecessor.occurredAt },
      );
    }

    const withoutDigest: Omit<ControlEventEnvelope, "eventDigest"> = {
      ...incoming,
      sequence: this.events.length + 1,
      predecessorEventId: predecessor?.eventId ?? null,
      predecessorEventDigest: predecessor?.eventDigest ?? null,
    };
    const envelope: ControlEventEnvelope = {
      ...withoutDigest,
      eventDigest: digestCanonical(eventDigestInput(withoutDigest), sha256Digest),
    };
    validateControlEventEnvelope(envelope);

    const stored = deepFreeze(structuredClone(envelope));
    this.events.push(stored);
    this.byEventId.set(stored.eventId, stored);
    if (stored.idempotencyKey) this.byIdempotencyKey.set(stored.idempotencyKey, stored);
    return structuredClone(stored);
  }

  readAll(): readonly ControlEventEnvelope[] {
    return this.events.map((event) => structuredClone(event));
  }
}

export function computeControlEventDigest(
  envelope: Omit<ControlEventEnvelope, "eventDigest">,
): Digest {
  return digestCanonical(eventDigestInput(envelope), sha256Digest);
}
