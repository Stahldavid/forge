// @forge-generated generator=0.0.0 input=d696decdcd326b4db3110ac75b5d3a35fc07db7cc9a986cb88d4a9166c899188 content=f1a909ecb10f7fc5c81d2e65b8295e86649af94b4c3b45b3ef93acb6ad39e9fd
export const clientManifest = {
  "schemaVersion": "1.0.0",
  "generatorVersion": "0.0.0",
  "inputHash": "c6aaf2cacb4add1792e63806c2a3f100548bc2b67a497275cbd2c666e29e9ee8",
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
