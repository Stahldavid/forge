// @forge-generated generator=0.1.0-alpha.3 input=036146e3c770368a0d71d33e4eff9252acb5ea90669f57bf119dcb1cb4b4e379 content=10d91b3db4466a56c5b174b6c515fb24c8ac2f682da85b757cea56cbaa71382e
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.3",
  "inputHash": "443894155b95f6caefdf5cfd53865d9f698630bafe62e9d79f63d131d7617c0f",
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
  "schemaVersion": "1",
  "tools": []
} as const;
