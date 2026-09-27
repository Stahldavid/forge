// @forge-generated generator=0.1.0-alpha.63 input=62246762620888d4eb3bd4233fe8c61c4adcead4d706dd12016618e6604e0aeb content=9893ba2b2189291fef35ab6ea0abea261f01415a078c25760333a00933c313ed
export const liveProtocol = {
  "messages": [
    "hello",
    "snapshot",
    "error",
    "heartbeat",
    "reset"
  ],
  "protocolVersion": "0.1.0",
  "resume": {
    "queryParam": "lastRevision",
    "sseLastEventId": true
  },
  "schemaVersion": "0.1.0",
  "snapshot": {
    "fullSnapshotOnly": true,
    "includesReleaseId": true,
    "includesRevision": true
  }
} as const;
