// @forge-generated generator=0.0.0 input=caf049950405a6022290d7ace56f44ae9b4892557c40e94a08bf463799a04c24 content=0f3bf5d91a51c90ea1c677edaf86b7bd07c5fc20e115d0549ef4c98a4dfc8d4c
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "c6c35622f17c6bc44ce7f73abd373533d9e4c7c30099abdee310d78f3e434a1c",
  "providers": [
    {
      "id": "anthropic",
      "integration": "ai-provider-anthropic",
      "packageName": "@ai-sdk/anthropic",
      "secretName": "ANTHROPIC_API_KEY"
    },
    {
      "id": "gateway",
      "integration": "ai-gateway",
      "packageName": "ai",
      "secretName": "AI_GATEWAY_API_KEY"
    },
    {
      "id": "openai",
      "integration": "ai-provider-openai",
      "packageName": "@ai-sdk/openai",
      "secretName": "OPENAI_API_KEY"
    }
  ],
  "schemaVersion": "1"
} as const;
