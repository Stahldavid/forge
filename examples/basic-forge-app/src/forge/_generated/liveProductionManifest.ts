// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=c752e925e1c2e428123d8d8028696374e8ceeca9a3a2bf95ff1664890671f746
export const liveProductionManifest = {
  "dependencyGranularity": "table-tenant",
  "invalidationSource": "durable-table",
  "limits": {
    "heartbeatIntervalMs": 15000,
    "maxPendingMessagesPerSubscription": 5,
    "maxSnapshotBytes": 1000000,
    "maxSubscriptionsPerClient": 50,
    "maxSubscriptionsPerTenant": 500,
    "rerunDebounceMs": 50
  },
  "liveQueries": [
    {
      "file": "src/queries/liveTickets.ts",
      "name": "liveTickets",
      "policy": "tickets.read"
    }
  ],
  "mode": "production-hardened",
  "schemaVersion": "0.1.0",
  "transports": [
    "sse"
  ],
  "wakeupAdapters": [
    "postgres-notify",
    "polling"
  ]
} as const;
