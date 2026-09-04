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

export class ResourceLedger {
  private readonly definitions: Record<string, ResourceDefinition>;
  private readonly reserved: Record<string, number> = {};
  private readonly consumed: Record<string, number> = {};
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

  reserve(
    reservationId: Identifier,
    ownerId: Identifier,
    requests: readonly ResourceReservationRequest[],
  ): ResourceReservation {
    const existing = this.reservations[reservationId];
    if (existing) {
      const requested = stableStringify({ ownerId, requests });
      const recorded = stableStringify({ ownerId: existing.ownerId, requests: existing.requests });
      if (requested !== recorded) {
        throw new AgentFabricError(
          "AF_CONFLICT",
          `Reservation ${reservationId} was reused with a different request`,
        );
      }
      return existing;
    }

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
          `Resource ${resource} would exceed its limit`,
          { amount, consumed, limit: definition.limit, reserved, resource },
        );
      }
    }

    const normalizedRequests = Object.entries(aggregated)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([resource, amount]) => ({ resource, amount }));

    for (const request of normalizedRequests) {
      const definition = this.definitions[request.resource]!;
      if (definition.semantics === "counter") {
        this.consumed[request.resource] = (this.consumed[request.resource] ?? 0) + request.amount;
      } else {
        this.reserved[request.resource] = (this.reserved[request.resource] ?? 0) + request.amount;
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
    this.reservations[reservationId] = reservation;
    return reservation;
  }

  consume(reservationId: Identifier): ResourceReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status !== "active") {
      return reservation;
    }

    for (const request of reservation.requests) {
      const definition = this.definitions[request.resource]!;
      if (definition.semantics === "capacity") {
        continue;
      }
      if (definition.semantics === "consumable") {
        this.reserved[request.resource] -= request.amount;
        this.consumed[request.resource] += request.amount;
      }
    }

    const next: ResourceReservation = { ...reservation, status: "consumed" };
    this.reservations[reservationId] = next;
    return next;
  }

  release(reservationId: Identifier): ResourceReservation {
    const reservation = this.requireReservation(reservationId);
    if (reservation.status === "released") {
      return reservation;
    }

    if (reservation.status === "active") {
      for (const request of reservation.requests) {
        const definition = this.definitions[request.resource]!;
        if (definition.semantics !== "counter") {
          this.reserved[request.resource] -= request.amount;
        }
      }
    } else {
      for (const request of reservation.requests) {
        const definition = this.definitions[request.resource]!;
        if (definition.semantics === "capacity") {
          this.reserved[request.resource] -= request.amount;
        }
      }
    }

    const next: ResourceReservation = { ...reservation, status: "released" };
    this.reservations[reservationId] = next;
    return next;
  }

  snapshot(): ResourceLedgerSnapshot {
    return {
      definitions: structuredClone(this.definitions),
      reserved: { ...this.reserved },
      consumed: { ...this.consumed },
      reservations: structuredClone(this.reservations),
    };
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
