// @forge-generated generator=0.0.0 input=3debe8250f2a55e0435ff17460670b7124ff352649ae964a2504f457192e5fa9 content=479332b6ebe02657ca6910bf544d8ca9480bd16a97fb0850340d294545eab0e5
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "422ea317dc0b4f7be63f112ccd5d1ba69180429b7d3824a1a340035c74563195",
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
