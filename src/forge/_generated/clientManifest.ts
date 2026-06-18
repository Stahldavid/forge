// @forge-generated generator=0.1.0-alpha.11 input=d1e9ea1b1e7d1268b74c027b8d605e187a9ea56cbbb5aeff174833ed68610c4c content=4a08a5313effadc1b95dc9f55da619a230909a3d2be547dd9bf3f8cb82fdb2a5
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.11",
  "inputHash": "73a603fb6c31a735dbb56f531dd479bb00588672009b7fbb0fbaebacffc6755b",
  "queries": [],
  "commands": [],
  "liveQueries": [],
  "transport": {
    "queries": "POST /queries/:name",
    "commands": "POST /commands/:name",
    "liveQueries": "GET /live/:name",
    "externalQueries": "POST /external/:service/queries/:name",
    "externalCommands": "POST /external/:service/commands/:name"
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
