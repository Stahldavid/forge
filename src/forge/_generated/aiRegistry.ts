// @forge-generated generator=0.1.0-alpha.68 input=eb85ce79777e8854119a312edd29262099578bdd5f8be82c03b5f0caae80f391 content=1fc5c7798960716ef74f6310e3ca78caaed640dc457a6d170ff74021bcc0fdc5
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [
    {
      "file": "src/forge/cli/ai.ts",
      "method": "generateText",
      "model": "unknown",
      "provider": "openai",
      "purpose": "cli_test"
    },
    {
      "file": "src/forge/cli/ai.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai",
      "purpose": "agent_model_redteam"
    },
    {
      "file": "src/forge/dev/server.ts",
      "method": "generateText",
      "model": "unknown",
      "provider": "openai",
      "purpose": "dev_test"
    },
    {
      "file": "src/forge/dev/server.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai"
    },
    {
      "file": "src/forge/runtime/context/create-context.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai"
    }
  ],
  "generatorVersion": "0.1.0-alpha.68",
  "inputHash": "cbc4159c147efe7b3912164502a9fb80f6d174742760501a51e72bba46048e26",
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
