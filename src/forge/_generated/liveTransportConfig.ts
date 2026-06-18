// @forge-generated generator=0.1.0-alpha.11 input=6d037d7c4786d870706e130952bd7f40146d318a8f8c76702bd02a34ef7dcbd3 content=9166cbf6c2ee6161ea374ec2da35d146fc04efd6f2a1ca307eb3518c4f6c2046
export const liveTransportConfig = {
  "defaultTransport": "sse",
  "schemaVersion": "0.1.0",
  "selfHostEnv": {
    "FORGE_LIVE_HEARTBEAT_MS": "15000",
    "FORGE_LIVE_INVALIDATION": "polling,postgres-notify",
    "FORGE_LIVE_POLL_INTERVAL_MS": "1000",
    "FORGE_LIVE_TRANSPORT": "sse"
  },
  "transports": {
    "sse": {
      "endpoint": "/live/:name",
      "heartbeat": true,
      "multiplexEndpoint": "/live/stream",
      "oneConnectionPerClientRecommended": true
    }
  }
} as const;
