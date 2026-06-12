// @forge-generated generator=0.0.0 input=498ae106c5515160f62c588c022c49b74d8c8010e752bf89723c14e54321364d content=199e60c991e658ba5cd58d6d8a512d9ecc8ed42fad3aafba41178675584c0302
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "14eceac8f3968c43953726773d5fb4c3ca142e2e7a68031228e98ce64a14a75d",
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
