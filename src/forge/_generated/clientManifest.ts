// @forge-generated generator=0.1.0-alpha.8 input=7e9241d38232a56e5930612085bbc6719ac771f9c0cd3f836ab721e9b76abb1d content=60d60dcd03f03e11920f4004c81ab6994af9ac47e11de7fc62674c0f2aef32cb
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.8",
  "inputHash": "8b2ab52504b342dcbf99eae4180e3481dbb7a16a8812e7b3515ea59f7d0fa712",
  "queries": [],
  "commands": [],
  "liveQueries": [],
  "transport": {
    "queries": "POST /queries/:name",
    "commands": "POST /commands/:name",
    "liveQueries": "GET /live/:name"
  },
  "react": {
    "entrypoint": "src/forge/_generated/react.ts",
    "hooks": [
      "ForgeProvider",
      "useForgeClient",
      "useAuth",
      "useQuery",
      "useCommand",
      "useLiveQuery"
    ]
  },
  "excluded": {
    "actions": [],
    "workflows": [],
    "serverAdapters": [
      "ai.anthropic.server.ts",
      "ai.gateway.server.ts",
      "ai.openai.server.ts"
    ],
    "serverPackages": [
      "@ai-sdk/anthropic",
      "@ai-sdk/openai",
      "ai"
    ]
  }
} as const;
