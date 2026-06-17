// @forge-generated generator=0.1.0-alpha.8 input=f772dc4340a6b12abe01e0d960539c3f9ee1708c106f8d98108b06b0dc708960 content=17aeff446ce4707e19ae04c8e7de3a59e04a4b6e2984bdc274a5eb57dbe2fd11
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.8",
  "inputHash": "66bea154b06ef5a54a8fb36da155669945f4e6356ce6763c4f3481634b7bf0c5",
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
