// @forge-generated generator=0.1.0-alpha.18 input=1c1ef7efb2ac73b43268abb18f6939fcb29db9810b977fe6c343d7c6b2bb8b0b content=70976e37f5591d233477a9581c0def76eb1b2c6672e31f5563008da45d922815
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.18",
  "inputHash": "4354e70afacae5344ee0fce2130a59722915d2a6253550f2d381472b721bd2a3",
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
