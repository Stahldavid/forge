// @forge-generated generator=0.1.0-alpha.0 input=2bec5acb1fae59bf9d55eca4937af5b76424e610905e4ef337a33d3f7ec220d2 content=be4d10bd2e23a74bb5d1cf831b86cde494c9a955feb8fa6d9dd29144804e2219
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.0",
  "inputHash": "eee8cfce07c0e866ad60ae1db06c9a7b23e5f26552c9971d90ca5acb986aeb08",
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
