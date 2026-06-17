// @forge-generated generator=0.1.0-alpha.8 input=f772dc4340a6b12abe01e0d960539c3f9ee1708c106f8d98108b06b0dc708960 content=25e978eeedf91bcc459d876d203b2f464a08040b6deb9a0d6b656fd0a479c99e
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.8",
  "inputHash": "e5ddaec066e7dc6fbfed0ca183d2933cc16689934eae1ad07c9ee06d46e6ea20",
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
