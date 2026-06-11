// @forge-generated generator=0.0.0 input=e3aac12cf3579fdd72c83a62dc7bfccf02deb235f7b566a6afffb37f538b1de1 content=41cca0576ee2084f31b170224f7157d3eaf090809c6b246cef1caf6734fc44cd
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "f4bc21259119109e9de9959472605ae6e981272ba5dc894826e3e608b436fe78",
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
