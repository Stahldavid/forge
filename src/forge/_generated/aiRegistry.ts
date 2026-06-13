// @forge-generated generator=0.0.0 input=69418484de69a159bdbb79b216f3f22ffd9b6248efdbc7597ea784e01145e4cb content=10f7b3252897c27105fa40c674c577061dcb66c61d0fa4a5b9f19bb54e766511
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "8f67d9ecb05ff66bad4cabc7894eb80176ad319ded052fae12a0412f7acd411f",
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
