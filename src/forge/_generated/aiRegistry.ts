// @forge-generated generator=0.0.0 input=73f6857f8307f1ab2a66f6d2d4b5eb6643ce6b342bc66ae7469f0837fa4195c0 content=135d18ef3f6831197c1a25d063a5465a785c1f7abf89bf68a2d012009197c2cd
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "0eb54fcbfdd92d54d3f157432d0c1253046abf84576c3d934ee7f264eff6bc54",
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
