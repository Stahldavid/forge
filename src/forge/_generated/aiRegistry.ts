// @forge-generated generator=0.0.0 input=2190d56a1db1355810806f497ad3a2e68f900245ae47a7cdc651f0cd2c949f50 content=ba29494da066647a298d4b0d4ad55d09f78c17033df891774e2eda10f40594ca
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "7285ae8286a2845e7533b3339cf0cf6f3a16f33ded4082bb9ca871b2302576ae",
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
