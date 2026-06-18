// @forge-generated generator=0.1.0-alpha.10 input=17d4dad0c0c44729ad234dea95690f1a993d0142a54695c77ac4008c415c73d5 content=9dcbaa6a8091be0eab4f231fa21f2829cb26a6d825ce39263043a937a042fe18
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.10",
  "inputHash": "325af30610dc9d80f12f0b546163a666782a6b1c852619d5da27f4f5f3894043",
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
