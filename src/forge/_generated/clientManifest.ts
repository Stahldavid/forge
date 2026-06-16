// @forge-generated generator=0.1.0-alpha.3 input=036146e3c770368a0d71d33e4eff9252acb5ea90669f57bf119dcb1cb4b4e379 content=a525c6d298dede6c91b49fa93e0f26edc28b53d3d5675b0f52bbc5d3b6fb9a49
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.1.0-alpha.3",
  "inputHash": "01dfa11f4cf42f238688906363bc87b4f897ea2f37f5fb6738a69a5089a8c105",
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
