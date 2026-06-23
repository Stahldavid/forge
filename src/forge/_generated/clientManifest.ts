// @forge-generated generator=0.1.0-alpha.19 input=bc0acfe814a5985cc4e818ea3aabd00bf4df870c2a7f98542671de2228b16a16 content=0deded31d2f1ed3c0c38f7f8f5841c75aa09f43b4ad2a421039eb10a2f9c1792
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.19",
  "inputHash": "55b4c8670659306fe83c89fd55bc3325d560dd706ff22868c4b2e997e2986177",
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
