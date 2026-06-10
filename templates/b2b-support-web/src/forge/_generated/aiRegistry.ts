// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=5c18ee2ce51edf407cd596063bc22287c8d8b1893e6f6494200a5803cc4775d9
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "method": "generateText",
      "model": "mock",
      "provider": "openai",
      "purpose": "ticket_triage"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "d80d8ed21d2b0fd40100cec231a7943a3fc3615b0ed2b18291555c489157c59c",
  "providers": [
    {
      "id": "openai",
      "integration": "ai-provider-openai",
      "packageName": "@ai-sdk/openai",
      "secretName": "OPENAI_API_KEY"
    },
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
    }
  ],
  "schemaVersion": "1"
} as const;
