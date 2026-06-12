// @forge-generated generator=0.0.0 input=c45e296339d22ed41837561d42721543343531289b1f95844b7c5e8e4d49ba48 content=ecbaf8588811e36c42ecb2d7c6b5629dd6d3a370445e8c8116c57fc04c6f269a
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "4d87c988ce6839e1c7d9db6ccac038c3957c4a8544084b607a06e288617c5608",
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
