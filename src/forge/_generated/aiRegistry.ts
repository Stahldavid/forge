// @forge-generated generator=0.0.0 input=74d18b2b2cd4d5e4291dadc9c7cfe7fb14d285012b483defddf50f750d3153f4 content=de53d8905ce0f43222d0acf68066f6c470d3ef7f6e765a98397921602e9f00b5
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "1eb83ad7e9ceab7b95a7bbd81fd514a874ec5e38727fcb2613f2be32156647b4",
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
