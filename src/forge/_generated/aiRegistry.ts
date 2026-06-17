// @forge-generated generator=0.1.0-alpha.9 input=7e1d521593b626abf25a35531d4a4d31d541cae45c515610751b15e073c4d5a7 content=d5b94dfb92398da75ce808dfc367ea5a54100660603d044a48562c9b91e83a24
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.9",
  "inputHash": "4a5fbe04500cc2127f996694335a3a76e35d63cca922df7352e7a25a9db45fa2",
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
