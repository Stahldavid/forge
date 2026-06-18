// @forge-generated generator=0.1.0-alpha.11 input=6d037d7c4786d870706e130952bd7f40146d318a8f8c76702bd02a34ef7dcbd3 content=969343db72275632c2d8d8d48502b79a47931f160a329b78698e8bc59929b01d
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.11",
  "inputHash": "6cab934cb96befb7767a725993ff3eec42e144f6aa10eaf40e4cb3fa82dbfecb",
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
  "schemaVersion": "1",
  "tools": []
} as const;
