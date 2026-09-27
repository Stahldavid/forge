// @forge-generated generator=0.1.0-alpha.64 input=5bea3de626e4a7db3a5bbe226a820619b19a6e1347922b0a4f97fedf6654c489 content=27a3fd362b85da0ebaf11345ce74bd252a9699ef453087fbf9ec48f7a7a7e11a
export const secretRegistry = {
  "secrets": [
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-gateway",
      "name": "AI_GATEWAY_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-provider-anthropic",
      "name": "ANTHROPIC_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-provider-openai",
      "name": "OPENAI_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    }
  ]
} as const;
