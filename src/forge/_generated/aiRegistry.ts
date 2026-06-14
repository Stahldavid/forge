// @forge-generated generator=0.0.0 input=eb8d78e749f083957f69f7f316aa4efc3faf5ccd81ff63e3cf32bf7fb7f705ac content=00f746d573abfe91ac813d74241fc756fcf6015c7eccb611b4e9180b9473a4fa
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "b0bf6a280d60ef13fcf378fd45be3ae4ff435da2967062538a2e96c1b1f0a21a",
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
