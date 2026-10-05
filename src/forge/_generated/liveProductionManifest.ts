// @forge-generated generator=0.1.0-alpha.67 input=eb277051b18f4b495658e3c98c326be25c673d51ed84f4988587e46c8969587d content=0439047e248d49da4c0bad6c54d6accfbdd68738a961a52f373ffb440742f841
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
