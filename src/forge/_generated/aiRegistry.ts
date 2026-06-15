// @forge-generated generator=0.1.0-alpha.0 input=4dbda59592f3ea3b2e8992aa95fec54fd7f948fb5fcacf9a05a77ed0f3792761 content=a99705a9a324d1d5de735a03b89e68130a1382fdc85f0f690487c1a30ab16a16
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.0",
  "inputHash": "c15eb954b4cf1aebf191b3f6e1efe57eb8fa60786521fb6c5d6e74af6b6381d2",
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
