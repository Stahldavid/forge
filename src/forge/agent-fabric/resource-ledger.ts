import { stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type {
  Identifier,
  ResourceDefinition,
  ResourceLedgerSnapshot,
  ResourceReservation,
  ResourceReservationRequest,
} from "./types.ts";

function assertAmount(amount: number, resource: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AgentFabricError(
      "AF_RESOURCE_EXHAUSTED",
      `Resource amount for ${resource} must be finite and greater than zero`,
      { amount, resource },
    );
  }
}

function bucket(
  records: Record<Identifier, Record<string, number>>,
  ownerId: Identifier,
): Record<string, number> {
  return records[ownerId] ?? (records[ownerId] = {});
}

function replaceRecord<T>(target: Record<string, T>, source: Readonly<Record<string, T>>): void {
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(source)) target[key] = structuredClone(value);
}

export class ResourceLedger {
  private readonly definitions: Record<string, ResourceDefinition>;
  private readonly reserved: Record<string, number> = {};
  private readonly consumed: Record<string, number> = {};
  private readonly ownerReserved: Record<Identifier, Record<string, number>> = {};
  private readonly ownerConsumed: Record<Identifier, Record<string, number>> = {};
  private readonly reservations: Record<Identifier, ResourceReservation> = {};

  constructor(definitions: readonly ResourceDefinition[]) {
    this.definitions = {};
    for (const definition of definitions) {
      if (this.definitions[definition.resource]) {
        throw new AgentFabricError(
          "AF_DUPLICATE_ID",
          `Duplicate resource definition: ${definition.resource}`,
        );
      }
      if (!Number.isFinite(definition.limit) || definition.limit < 0) {
        throw new AgentFabricError(
          "AF_INVALID_STATE",
          `Resource limit for ${definition.resource} must be finite and non-negative`,
        );
      }
      this.definitions[definition.resource] = { ...definition };
      this.reserved[definition.resource] = 0;
      this.consumed[definition.resource] = 0;
    }
  }

  static fromSnapshot(snapshot: ResourceLedgerSnapshot): ResourceLedger {
    const ledger = new ResourceLedger(Object.values(snapshot.definitions));
    const freshDefinitions = ledger.snapshot().definitions;
    if (stableStringify(freshDefinitions) !== stableStringify(snapshot.definitions)) {
      throw new AgentFabricError(
        "AF_INVALID_STATE",
        "ResourceLedger snapshot definitions are not canonical",
      );
    }
    ledger.restore(snapshot);
    return ledger;
  }

  transaction<T>(operation: () => T): T {
    const before = this.snapshot();
    try {
      return operation();
    } catch (error) {
      this.restore(before);
      throw error;
    }
  }

  reserve(
    reservationId: Identifier,
    ownerId: Identifier,
    requests: readonly ResourceReservationRequest[],
    ownerCeilings?: Readonly<Record<string, number>>,
  ): ResourceReservation {
    const aggregated: Record<string, number> = {};
    for (const request of requests) {
      assertAmount(request.amount, request.resource);
      if (!this.definitions[request.resource]) {
        throw new AgentFabricError(
          "AF_NOT_FOUND",
          `Unknown resource: ${request.resource}`,
        );
      }
      aggregated[request.resource] = (aggregated[request.resource] ?? 0) + request.amount;
    }

    const normalizedRequests = Object.entries(aggregated)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resource, amount]) => ({ resource, amount }));

    const existing = this.reservations[reservationId];
    if (existing) {
      const requested = stableStringify({ ownerId, requests: normalizedRequests });
      const recorded = stableStringify({ ownerId: existing.ownerId, requests: existing.requests });
      if (requested !== recorded) {
        throw new AgentFabricError(
          "AF_CONFLICT",
          `Reservation ${reservationId} was reused with a different request`,
        );
      }
      return structuredClone(existing);
    }

    const ownerReserved = bucket(this.ownerReserved, ownerId);
    const ownerConsumed = bucket(this.ownerConsumed, ownerId);
    for (const [resource, amount] of Object.entries(aggregated)) {
      const definition = this.definitions[resource]!;
      const reserved = this.reserved[resource] ?? 0;
      const consumed = this.consumed[resource] ?? 0;
      const projected = definition.semantics === "counter"
        ? consumed + amount
        : reserved + consumed + amount;
      if (projected > definition.limit) {
        throw new AgentFabricError(
          "AF_RESOURCE_EXHAUSTED",
          `Resource ${resource} would exceed its global limit`,
          { amount, consumed, limit: definition.limit, reserved, resource },
        );
      }

      if (ownerCeilings) {
        const ceiling = ownerCeilings[resource];
        if (ceiling === undefined) {
          throw new AgentFabricError(
            "AF_RESOURCE_EXHAUSTED",
            `Owner ${ownerId} has no ceiling for resource ${resource}`,
            { ownerId, resource },
          );
        }
        const ownerProjected = definition.semantics === "counter"
          ? (ownerConsumed[resource] ?? 0) + amount
          : (ownerReserved[resource] ?? 0) + (ownerConsumed[resource] ?? 0) + amount;
        if (ownerProjected > ceiling) {
          throw new AgentFabricError(
            "AF_RESOURCE_EXHAUSTED",
            `Resource ${resource} would exceed the ceiling for ${ownerId}`,
            { amount, ceiling, ownerId, projected: ownerProjected, resource },
          );
        }
      }
    }

    for (const request of normalizedRequests) {
      const definition = this.definitions[request.resource]!;
      if (definition.semantics === "counter") {
        this.consumed[request.resource] = (this.consumed[request.resource] ?? 0) + request.amount;
        ownerConsumed[request.resource] = (ownerConsumed[request.resource] ?? 0) + request.amount;
      } else {
        this.reserved[request.resource] = (this.reserved[request.resource] ?? 0) + request.amount;
        ownerReserved[request.resource] = (ownerReserved[request.resource] ?? 0) + request.amount;
      }
    }

    const reservation: ResourceReservation = {
      reservationId,
      ownerId,
      requests: normalizedRequests,
      status: normalizedRequests.some(
        (request) => this.definitions[request.resource]?.semantics !== "counter",
      ) ? "active" : "consumed",
    };
    this.reservations[reservationId] = structuredClone(reservation);
    return structuredClone(reservation);
  }

  consume(reservationId: Identifier): ResourceReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status !== "active") return structuredClone(reservation);

    const ownerReserved = bucket(this.ownerReserved, reservation.ownerId);
    const ownerConsumed = bucket(this.ownerConsumed, reservation.ownerId);
    for (const request of reservation.requests) {
      const definition = this.definitions[request.resource]!;
      if (definition.semantics === "capacity") continue;
      if (definition.semantics === "consumable") {
        this.reserved[request.resource] -= request.amount;
        this.consumed[request.resource] += request.amount;
        ownerReserved[request.resource] = (ownerReserved[request.resource] ?? 0) - request.amount;
        ownerConsumed[request.resource] = (ownerConsumed[request.resource] ?? 0) + request.amount;
      }
    }

    const next: ResourceReservation = { ...reservation, status: "consumed" };
    this.reservations[reservationId] = structuredClone(next);
    return structuredClone(next);
  }

  release(reservationId: Identifier): ResourceReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status === "released") return structuredClone(reservation);

    const ownerReserved = bucket(this.ownerReserved, reservation.ownerId);
    if (reservation.status === "active") {
      for (const request of reservation.requests) {
        const definition = this.definitions[request.resource]!;
        if (definition.semantics !== "counter") {
          this.reserved[request.resource] -= request.amount;
          ownerReserved[request.resource] = (ownerReserved[request.resource] ?? 0) - request.amount;
        }
      }
    } else {
      for (const request of reservation.requests) {
        const definition = this.definitions[request.resource]!;
        if (definition.semantics === "capacity") {
          this.reserved[request.resource] -= request.amount;
          ownerReserved[request.resource] = (ownerReserved[request.resource] ?? 0) - request.amount;
        }
      }
    }

    const next: ResourceReservation = { ...reservation, status: "released" };
    this.reservations[reservationId] = structuredClone(next);
    return structuredClone(next);
  }

  snapshot(): ResourceLedgerSnapshot {
    return {
      definitions: structuredClone(this.definitions),
      reserved: { ...this.reserved },
      consumed: { ...this.consumed },
      ownerReserved: structuredClone(this.ownerReserved),
      ownerConsumed: structuredClone(this.ownerConsumed),
      reservations: structuredClone(this.reservations),
    };
  }

  private restore(snapshot: ResourceLedgerSnapshot): void {
    replaceRecord(this.reserved, snapshot.reserved);
    replaceRecord(this.consumed, snapshot.consumed);
    replaceRecord(this.ownerReserved, snapshot.ownerReserved as Readonly<Record<string, Record<string, number>>>);
    replaceRecord(this.ownerConsumed, snapshot.ownerConsumed as Readonly<Record<string, Record<string, number>>>);
    replaceRecord(this.reservations, snapshot.reservations);
  }

  private requireReservation(reservationId: Identifier): ResourceReservation {
    const reservation = this.reservations[reservationId];
    if (!reservation) {
      throw new AgentFabricError(
        "AF_NOT_FOUND",
        `Unknown reservation: ${reservationId}`,
      );
    }
    return reservation;
  }
}
