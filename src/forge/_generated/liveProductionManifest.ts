// @forge-generated generator=0.1.0-alpha.16 input=48860df69cb90d3dd3e4ab7f4a96c04ae6aaf13e86500ee34868ba58a6c23650 content=0439047e248d49da4c0bad6c54d6accfbdd68738a961a52f373ffb440742f841
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
