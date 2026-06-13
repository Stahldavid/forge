// @forge-generated generator=0.0.0 input=c0f3bfb2de3d7162979646f619fa450e1cc14abfa5a5bc0a822069acdda7803b content=ab4a4f1a64d3e1948ff2fc3f5639651a6ced7fc2dd82b7ebb46ebe145d2af30c
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "892c18a7a1e9a0f7077808f0f55a4addb4e9d6d4c6898d28abd23ff097bd5109",
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
