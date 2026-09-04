import { stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { ControlEventEnvelope, Identifier, UncommittedControlEvent } from "./types.ts";

export interface AppendControlEventInput {
  expectedSequence: number;
  event: UncommittedControlEvent;
}

export interface ControlJournal {
  append(input: AppendControlEventInput): ControlEventEnvelope;
  readAll(): readonly ControlEventEnvelope[];
}

export class MemoryControlJournal implements ControlJournal {
  private readonly events: ControlEventEnvelope[] = [];
  private readonly byEventId = new Map<Identifier, ControlEventEnvelope>();
  private readonly byIdempotencyKey = new Map<Identifier, ControlEventEnvelope>();

  append(input: AppendControlEventInput): ControlEventEnvelope {
    const semanticFingerprint = stableStringify({
      eventId: input.event.eventId,
      rootExecutionId: input.event.rootExecutionId,
      payload: input.event.payload,
    });

    const existingByIdempotency = input.event.idempotencyKey
      ? this.byIdempotencyKey.get(input.event.idempotencyKey)
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
          `Idempotency key ${input.event.idempotencyKey} was reused with different content`,
        );
      }
      return existingByIdempotency;
    }

    const existingById = this.byEventId.get(input.event.eventId);
    if (existingById) {
      const existingFingerprint = stableStringify({
        eventId: existingById.eventId,
        rootExecutionId: existingById.rootExecutionId,
        payload: existingById.payload,
      });
      if (semanticFingerprint !== existingFingerprint) {
        throw new AgentFabricError(
          "AF_DUPLICATE_ID",
          `Event ID ${input.event.eventId} was reused with different content`,
        );
      }
      return existingById;
    }

    if (input.expectedSequence !== this.events.length) {
      throw new AgentFabricError(
        "AF_CONFLICT",
        "Control journal compare-and-swap failed",
        { actualSequence: this.events.length, expectedSequence: input.expectedSequence },
      );
    }

    const predecessor = this.events[this.events.length - 1];
    const envelope: ControlEventEnvelope = {
      ...input.event,
      sequence: this.events.length + 1,
      predecessorEventId: predecessor?.eventId ?? null,
    };
    this.events.push(envelope);
    this.byEventId.set(envelope.eventId, envelope);
    if (envelope.idempotencyKey) {
      this.byIdempotencyKey.set(envelope.idempotencyKey, envelope);
    }
    return envelope;
  }

  readAll(): readonly ControlEventEnvelope[] {
    return this.events.map((event) => structuredClone(event));
  }
}
