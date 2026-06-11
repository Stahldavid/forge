// @forge-generated generator=0.0.0 input=87ebe776bf3c110739fc121479e374ce267045f769d5a6e3c0be1b7957dc5089 content=f77b68186ebe7fd6423420b16f923fef41c516e49da79f325369a8dd675d885d
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "457603453a01e85d25e4f3928e64a1cde8a01cb166c7ad11df782edc52e027d2",
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
