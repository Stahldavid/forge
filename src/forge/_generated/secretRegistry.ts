// @forge-generated generator=0.1.0-alpha.67 input=eb277051b18f4b495658e3c98c326be25c673d51ed84f4988587e46c8969587d content=27a3fd362b85da0ebaf11345ce74bd252a9699ef453087fbf9ec48f7a7a7e11a
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
