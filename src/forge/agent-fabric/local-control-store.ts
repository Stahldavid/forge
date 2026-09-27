import type { DbAdapter } from "../runtime/db/adapter.ts";
import { sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { ForgeAgentConductor } from "./hardened-conductor.ts";
import { MemoryControlJournal } from "./journal.ts";
import { replayControlState } from "./hardened-reducer.ts";
import { ResourceLedger } from "./resource-ledger.ts";
import type {
  Clock, ControlEventEnvelope, OwnerAuthorizationVerifier, ResourceDefinition,
  UncommittedControlEvent,
} from "./types.ts";

const CREATE_EVENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_control_events (
    root_execution_id TEXT NOT NULL,
    event_sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    idempotency_key TEXT,
    envelope_json TEXT NOT NULL,
    PRIMARY KEY (root_execution_id, event_sequence),
    UNIQUE (root_execution_id, event_id),
    UNIQUE (root_execution_id, idempotency_key)
  )`;

export interface LocalControlStoreOptions {
  adapter: DbAdapter;
  clock: Clock;
  ownerAuthorizationVerifier: OwnerAuthorizationVerifier;
  resourceDefinitions?: readonly ResourceDefinition[];
}

export interface LocalControlTransitionResult<T> {
  result: T;
  events: readonly ControlEventEnvelope[];
}

/**
 * Single-process PGlite transaction boundary around the synchronous P0a Conductor.
 * Only trusted server code may call transition; callbacks must have no external effects.
 */
export class LocalControlStore {
  private tail: Promise<void> = Promise.resolve();
  private readonly definitions: readonly ResourceDefinition[];
  private schemaReady?: Promise<unknown>;
  private closed = false;

  constructor(private readonly options: LocalControlStoreOptions) {
    if (options.adapter.kind !== "pglite") {
      throw new AgentFabricError("AF_INVALID_STATE", "Local control store requires the PGlite adapter");
    }
    this.definitions = structuredClone(options.resourceDefinitions ?? []);
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new AgentFabricError("AF_INVALID_STATE", "Local control store is closed");
    const predecessor = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await predecessor;
    try {
      this.schemaReady ??= this.options.adapter.query(CREATE_EVENTS_TABLE);
      await this.schemaReady;
      return await operation();
    } finally {
      release();
    }
  }

  private async load(rootExecutionId: string): Promise<ControlEventEnvelope[]> {
    if (!rootExecutionId || rootExecutionId.length > 128) {
      throw new AgentFabricError("AF_INVALID_STATE", "Invalid root execution identity");
    }
    const result = await this.options.adapter.query(
      `SELECT event_sequence, envelope_json FROM _forge_agent_fabric_control_events
       WHERE root_execution_id = $1 ORDER BY event_sequence`,
      [rootExecutionId],
    );
    const events: ControlEventEnvelope[] = [];
    for (const row of result.rows) {
      if (typeof row.envelope_json !== "string") {
        throw new AgentFabricError("AF_INVALID_EVENT", "Stored control envelope is missing");
      }
      let event: ControlEventEnvelope;
      try {
        event = JSON.parse(row.envelope_json) as ControlEventEnvelope;
      } catch {
        throw new AgentFabricError("AF_INVALID_EVENT", "Stored control envelope is not JSON");
      }
      if (!event || typeof event !== "object" ||
          event.rootExecutionId !== rootExecutionId || event.sequence !== row.event_sequence) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Stored control envelope is outside its stream");
      }
      events.push(event);
    }
    replayControlState(events, {
      ownerAuthorizationVerifier: this.options.ownerAuthorizationVerifier,
      resourceDefinitions: this.definitions,
    });
    return events;
  }

  async readAll(rootExecutionId: string): Promise<readonly ControlEventEnvelope[]> {
    return this.serialized(async () => structuredClone(await this.load(rootExecutionId)));
  }

  private hydrate(rootExecutionId: string, before: readonly ControlEventEnvelope[]): {
    journal: MemoryControlJournal;
    conductor: ForgeAgentConductor;
  } {
    const journal = new MemoryControlJournal();
    for (const stored of before) {
      const {
        sequence: _sequence,
        predecessorEventId: _predecessorEventId,
        predecessorEventDigest: _predecessorEventDigest,
        eventDigest: _eventDigest,
        ...uncommitted
      } = stored;
      const restored = journal.append({
        expectedSequence: journal.readAll().length,
        event: uncommitted as UncommittedControlEvent,
      });
      if (stableStringify(restored) !== stableStringify(stored)) {
        throw new AgentFabricError("AF_INVALID_EVENT", "Stored control event changed during hydration");
      }
    }
    const ledger = this.definitions.length > 0
      ? new ResourceLedger(this.definitions)
      : undefined;
    return {
      journal,
      conductor: new ForgeAgentConductor(
        rootExecutionId, journal, this.options.clock, sha256Digest,
        this.options.ownerAuthorizationVerifier, ledger,
      ),
    };
  }

  private async persist(rootExecutionId: string, beforeCount: number, additions: readonly ControlEventEnvelope[]): Promise<void> {
    if (additions.length === 0) return;
    const transaction = await this.options.adapter.begin();
    try {
      const cursor = await transaction.query(
        `SELECT COALESCE(MAX(event_sequence), 0) AS current_sequence
         FROM _forge_agent_fabric_control_events WHERE root_execution_id = $1`,
        [rootExecutionId],
      );
      if (Number(cursor.rows[0]?.current_sequence) !== beforeCount) {
        throw new AgentFabricError("AF_CONFLICT", "Local control journal compare-and-swap failed");
      }
      for (const event of additions) {
        await transaction.query(
          `INSERT INTO _forge_agent_fabric_control_events
           (root_execution_id, event_sequence, event_id, idempotency_key, envelope_json)
           VALUES ($1, $2, $3, $4, $5)`,
          [rootExecutionId, event.sequence, event.eventId, event.idempotencyKey ?? null,
            stableStringify(event)],
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    }
  }

  async transition<T>(
    rootExecutionId: string,
    operation: (conductor: ForgeAgentConductor) => T,
  ): Promise<LocalControlTransitionResult<T>> {
    return this.serialized(async () => {
      const before = await this.load(rootExecutionId);
      const { journal, conductor } = this.hydrate(rootExecutionId, before);
      const result = operation(conductor);
      if (result && typeof result === "object" && "then" in result) {
        throw new AgentFabricError("AF_INVALID_STATE", "Control transitions must be synchronous");
      }
      const after = journal.readAll();
      const additions = after.slice(before.length);
      await this.persist(rootExecutionId, before.length, additions);
      return { result, events: after };
    });
  }

  /**
   * Hold the single-owner store while an external adapter runs. The permit is
   * committed in a prior transition. A crash leaves that permit without an
   * outcome, which recovery must classify as uncertain rather than retrying.
   */
  async runExternal<T>(
    rootExecutionId: string,
    operation: (conductor: ForgeAgentConductor) => Promise<T>,
  ): Promise<LocalControlTransitionResult<T>> {
    return this.serialized(async () => {
      const before = await this.load(rootExecutionId);
      const { journal, conductor } = this.hydrate(rootExecutionId, before);
      let result: T | undefined;
      let failure: unknown;
      try {
        result = await operation(conductor);
      } catch (error) {
        failure = error;
      }
      const after = journal.readAll();
      await this.persist(rootExecutionId, before.length, after.slice(before.length));
      if (failure !== undefined) throw failure;
      return { result: result as T, events: after };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.tail;
    await this.options.adapter.close();
  }
}
