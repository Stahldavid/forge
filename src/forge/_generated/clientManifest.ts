// @forge-generated generator=0.1.0-alpha.67 input=38da8c5c03d84214b14dc14a394d242e2dd8b8789e72edd7a1b94ea7d1002f19 content=1cc6b2025a89802560ae3110f9f686a53dff3953aa0c812adf35dde946b6bc53
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.67",
  "inputHash": "28a81d73ac42726795f2e909c45d35c3758d0e2dae8113c7771173a8f4c95119",
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
