// @forge-generated generator=0.1.0-alpha.3 input=991570b39d634099828586e546d58e2eeae22189c5392405901477094c1855ae content=4aa0c09676f23fc80ff4676c754e6c0961394524d6b24c531ac3b608fbdea9ca
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.3",
  "inputHash": "b9f9babff4f053b0ac152f7c5bb0fe5e8e7f90026b9ca12544f4786366dacadb",
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
