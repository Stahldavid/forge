// @forge-generated generator=0.0.0 input=a7d16d11442ec294033d6f6c5745f3d05275c67221ab40c01ff470ccb2dc627e content=4ef0a9aa7591cfad2f2da03dcc16d0c0bbb85a80fd5c8d1d55219a3eb615621e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "ded62122dd5da1051bb999aa2849b9af23b9138fbbf8fe3db45e3c22c980334c",
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
