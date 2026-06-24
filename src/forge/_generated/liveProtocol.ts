// @forge-generated generator=0.1.0-alpha.23 input=eec97c876c38e3c86c16e6a488b4abbd0d9253406b5e3a492f6674a134d0d950 content=9893ba2b2189291fef35ab6ea0abea261f01415a078c25760333a00933c313ed
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
