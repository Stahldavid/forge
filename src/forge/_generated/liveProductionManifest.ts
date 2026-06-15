// @forge-generated generator=0.1.0-alpha.2 input=58a72e10cb9647fa0d43ab28ebda1633d68b0cad8579c6a19686b78b101febbd content=0439047e248d49da4c0bad6c54d6accfbdd68738a961a52f373ffb440742f841
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
  "liveQueries": [],
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
