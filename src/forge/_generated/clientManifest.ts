// @forge-generated generator=0.1.0-alpha.63 input=128a75a60a7187f4b372ac9ffdd8c42ca3f2eac7281400dd5418fce8108ea630 content=f398a8d6bbe1afa4aac71b1d69098fb172dcc963eb8f43e6903d61193cec0332
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.63",
  "inputHash": "9f88286df66ae9fc4d1b4626429f65d9b6e8b93feb417c646bfe6d5f8593906e",
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
  "vue": {
    "entrypoint": "src/forge/_generated/vue.ts",
    "composables": [
      "provideForge",
      "useForgeClient",
      "useForgeAuth",
      "useForgeQuery",
      "useForgeCommand",
      "useForgeLiveQuery"
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
