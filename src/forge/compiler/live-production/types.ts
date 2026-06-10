import type { LiveQueryRegistry } from "../types/live-query-registry.ts";

export interface LiveProductionManifest {
  schemaVersion: "0.1.0";
  mode: "production-hardened";
  dependencyGranularity: "table-tenant";
  invalidationSource: "durable-table";
  wakeupAdapters: ("postgres-notify" | "polling")[];
  transports: ("sse")[];
  liveQueries: Array<{
    name: string;
    policy?: string;
    file: string;
  }>;
  limits: {
    maxSubscriptionsPerClient: number;
    maxSubscriptionsPerTenant: number;
    maxSnapshotBytes: number;
    maxPendingMessagesPerSubscription: number;
    heartbeatIntervalMs: number;
    rerunDebounceMs: number;
  };
}

export interface LiveProtocolManifest {
  schemaVersion: "0.1.0";
  protocolVersion: "0.1.0";
  messages: string[];
  resume: {
    sseLastEventId: true;
    queryParam: "lastRevision";
  };
  snapshot: {
    includesRevision: true;
    includesReleaseId: true;
    fullSnapshotOnly: true;
  };
}

export interface LiveTransportConfig {
  schemaVersion: "0.1.0";
  defaultTransport: "sse";
  transports: {
    sse: {
      endpoint: "/live/:name";
      multiplexEndpoint: "/live/stream";
      heartbeat: true;
      oneConnectionPerClientRecommended: true;
    };
  };
  selfHostEnv: Record<string, string>;
}

export interface LiveProductionArtifacts {
  liveProductionManifest: LiveProductionManifest;
  liveProtocol: LiveProtocolManifest;
  liveTransportConfig: LiveTransportConfig;
}

export function buildLiveProductionArtifacts(
  registry: LiveQueryRegistry,
): LiveProductionArtifacts {
  const limits = {
    maxSubscriptionsPerClient: 50,
    maxSubscriptionsPerTenant: 500,
    maxSnapshotBytes: 1_000_000,
    maxPendingMessagesPerSubscription: 5,
    heartbeatIntervalMs: 15_000,
    rerunDebounceMs: 50,
  };

  return {
    liveProductionManifest: {
      schemaVersion: "0.1.0",
      mode: "production-hardened",
      dependencyGranularity: "table-tenant",
      invalidationSource: "durable-table",
      wakeupAdapters: ["postgres-notify", "polling"],
      transports: ["sse"],
      liveQueries: registry.liveQueries
        .map((liveQuery) => ({
          name: liveQuery.name,
          ...(liveQuery.policy ? { policy: liveQuery.policy } : {}),
          file: liveQuery.file,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      limits,
    },
    liveProtocol: {
      schemaVersion: "0.1.0",
      protocolVersion: "0.1.0",
      messages: ["hello", "snapshot", "error", "heartbeat", "reset"],
      resume: {
        sseLastEventId: true,
        queryParam: "lastRevision",
      },
      snapshot: {
        includesRevision: true,
        includesReleaseId: true,
        fullSnapshotOnly: true,
      },
    },
    liveTransportConfig: {
      schemaVersion: "0.1.0",
      defaultTransport: "sse",
      transports: {
        sse: {
          endpoint: "/live/:name",
          multiplexEndpoint: "/live/stream",
          heartbeat: true,
          oneConnectionPerClientRecommended: true,
        },
      },
      selfHostEnv: {
        FORGE_LIVE_TRANSPORT: "sse",
        FORGE_LIVE_INVALIDATION: "polling,postgres-notify",
        FORGE_LIVE_POLL_INTERVAL_MS: "1000",
        FORGE_LIVE_HEARTBEAT_MS: "15000",
      },
    },
  };
}
