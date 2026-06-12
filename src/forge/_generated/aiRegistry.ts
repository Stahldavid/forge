// @forge-generated generator=0.0.0 input=8f5553c2c0025eb9c0a596bb153787d0ccb8e0782cf6c0b8be14806581f906e6 content=c7c950a94146ce074b49fb2ccb157a3284f167d871fe38eacb0bb45b9027df44
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "0cee3077ad96c088b2453b6deaa11c3dad489cc6d1851c0560ec1902d851d77b",
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
