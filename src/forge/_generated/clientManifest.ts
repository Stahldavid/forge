// @forge-generated generator=0.1.0-alpha.39 input=f8919744f953e216381deb3344bfadd99210164d5b86a1ecfa27c2e44825c874 content=a81317d382d691909bf1f658d6c651514959784ca21f713bcf5d5848b14b5883
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.39",
  "inputHash": "70b9898aabc8dcb9c7d96dcb296ee1a2ebf02b10f10833714b8c54f6d4b3a44b",
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
