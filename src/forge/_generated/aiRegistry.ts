// @forge-generated generator=0.0.0 input=58ce779f1e2c5124e56b04cd4c3a1ae36cf613091a9f4fa2dd8d05a5243c64b1 content=208fbadbc6130d6f70f9eae9cfe939791407ee488b38fda8f06320e6f6491de4
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "1c6707e3885ce7915aadf4ddb4cdc2e98b1dfedb697beaffa4b796a06df1a3bf",
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
