// @forge-generated generator=0.1.0-alpha.63 input=84e91710081b76fb63c11fe704185090832d0113ff972e147f9de33e12dd16f7 content=89baa5d9984f3e846f1c3dc9a3f7e04729f11bf28a4d30098b440bce4dda7c1d
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
  "generatorVersion": "0.1.0-alpha.63",
  "inputHash": "8d919e58d83f579059de362a50bb9f5edddd68e45040dfdd64da6adb3bf53182",
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
