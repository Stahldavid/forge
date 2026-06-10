import type { AuthContext } from "../auth/types.ts";

export interface DataDependency {
  table: string;
  tenantId: string;
}

export interface DataChange {
  tables: string[];
  tenantId: string;
  operation?: "insert" | "update" | "delete" | "write";
  revision?: number;
  traceId?: string;
}

export interface LiveInvalidation {
  id: number;
  revision: number;
  tableName: string;
  tenantId: string | null;
  operation: string;
  sourceKind: string;
  sourceName?: string;
  traceId?: string;
  releaseId?: string;
  deployId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type LiveMessage =
  | {
      type: "hello";
      protocolVersion: "0.1.0";
      connectionId?: string;
      releaseId?: string;
      deployId?: string;
      serverTime: string;
    }
  | {
      type: "snapshot";
      subscriptionId: string;
      liveQuery?: string;
      revision: number;
      data: unknown;
      traceId?: string;
      rowCount?: number;
      releaseId?: string;
    }
  | {
      type: "error";
      subscriptionId: string;
      code?: string;
      message?: string;
      traceId?: string;
      retryable?: boolean;
      error: {
        code: string;
        message: string;
        traceId?: string;
      };
    }
  | {
      type: "heartbeat";
      subscriptionId?: string;
      serverTime: string;
    }
  | {
      type: "reset";
      subscriptionId?: string;
      reason: "release_changed";
      releaseId?: string;
    };

export interface LiveSubscribeInput {
  name: string;
  args: unknown;
  auth: AuthContext;
  lastRevision?: number;
  send: (message: LiveMessage) => void;
}

export interface LiveSubscription {
  id: string;
  name: string;
  args: unknown;
  auth: AuthContext;
  lastSentRevision: number;
  revision: number;
  dependencies: DataDependency[];
  status: "active" | "closing" | "closed";
  createdAt: string;
  lastSentAt?: string;
  releaseId?: string;
  send: (message: LiveMessage) => void;
}

export interface LiveSubscriptionManager {
  subscribe(input: LiveSubscribeInput): Promise<LiveSubscription>;
  notifyDataChanged(change: DataChange): Promise<void>;
  processInvalidationsSince(revision?: number): Promise<number>;
  unsubscribe(id: string): void;
  debug(id: string): LiveSubscription | null;
  status(): {
    runtime: {
      id: string;
      transport: "sse";
      subscriptions: number;
    };
    invalidation: {
      lastSeenRevision: number;
      lastProcessedRevision: number;
      polling: boolean;
      postgresNotify: boolean;
    };
    limits: LiveProductionLimits;
  };
  stats(): { subscriptions: number; liveQueries: number; lastRevision: number };
  stop(): void;
}

export interface WriteTracker {
  changes: DataChange[];
  record(table: string, tenantId: string | null, operation?: DataChange["operation"]): void;
}

export interface LiveProductionLimits {
  maxSubscriptionsPerClient: number;
  maxSubscriptionsPerTenant: number;
  maxSnapshotBytes: number;
  maxPendingMessagesPerSubscription: number;
  heartbeatIntervalMs: number;
  rerunDebounceMs: number;
}

export const DEFAULT_LIVE_LIMITS: LiveProductionLimits = {
  maxSubscriptionsPerClient: 50,
  maxSubscriptionsPerTenant: 500,
  maxSnapshotBytes: 1_000_000,
  maxPendingMessagesPerSubscription: 5,
  heartbeatIntervalMs: 15_000,
  rerunDebounceMs: 50,
};
