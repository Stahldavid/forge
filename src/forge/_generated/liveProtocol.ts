// @forge-generated generator=0.1.0-alpha.63 input=3ba530f8432c93912c3e9b02ed9be6c6365dad9216f0a63d0c0a517cb06d4665 content=9893ba2b2189291fef35ab6ea0abea261f01415a078c25760333a00933c313ed
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
