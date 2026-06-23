// @forge-generated generator=0.1.0-alpha.18 input=0ee1bf2f038128efd72c20246ad0f70215b2e3ba0bf04eba957f20f4cdeea9cc content=9893ba2b2189291fef35ab6ea0abea261f01415a078c25760333a00933c313ed
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
