// @forge-generated generator=0.1.0-alpha.63 input=a08fcdd61a2c08c9ad9f137db56d152ed9da57eb81f62f3955e05ebec85271ff content=9893ba2b2189291fef35ab6ea0abea261f01415a078c25760333a00933c313ed
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
