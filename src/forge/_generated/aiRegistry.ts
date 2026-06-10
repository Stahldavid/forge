// @forge-generated generator=0.0.0 input=599ea226bf5bd821e0f149e2735ad55710baa7c45683bce4b2702a98f8216a58 content=e4bbc4d2c78ca8cbcd7128350112eee0ba32ba0543bfe4bd0010ea926802d7f5
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "3d289ab5b1082f09f504f5ccff4f419808de0a9b63b81a3f405c8cf30cb2785a",
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
