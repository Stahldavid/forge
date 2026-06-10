// @forge-generated generator=0.0.0 input=8a19e2a63936d6a797c1b59e262d1b428845c88e38157a19d0c967a180c126aa content=16cc5822e61aa11f06389e98e337908e359ee0a8aec5cba8028f35f1b6bfe8a3
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "7117ea995a99b3be9a98365e4ff1c4a8714bc141037d3d546050ee40ff039a36",
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
