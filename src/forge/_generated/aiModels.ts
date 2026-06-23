// @forge-generated generator=0.1.0-alpha.18 input=0ee1bf2f038128efd72c20246ad0f70215b2e3ba0bf04eba957f20f4cdeea9cc content=540a13e48caff6d5d20bc6f73964ce6c9801635a85ba7104896092026525c29a
export const aiModels = {
  "models": [
    {
      "inputCostPer1kTokensUsd": 0.0008,
      "model": "claude-3-5-haiku-20241022",
      "outputCostPer1kTokensUsd": 0.004,
      "provider": "anthropic"
    },
    {
      "inputCostPer1kTokensUsd": 0.003,
      "model": "claude-3-5-sonnet-20241022",
      "outputCostPer1kTokensUsd": 0.015,
      "provider": "anthropic"
    },
    {
      "model": "claude-sonnet-4.5",
      "provider": "anthropic"
    },
    {
      "model": "anthropic/claude-sonnet-4.5",
      "provider": "gateway"
    },
    {
      "inputCostPer1kTokensUsd": 0.0025,
      "model": "openai/gpt-4o",
      "outputCostPer1kTokensUsd": 0.01,
      "provider": "gateway"
    },
    {
      "model": "openai/gpt-5.4",
      "provider": "gateway"
    },
    {
      "inputCostPer1kTokensUsd": 0.0025,
      "model": "gpt-4o",
      "outputCostPer1kTokensUsd": 0.01,
      "provider": "openai"
    },
    {
      "inputCostPer1kTokensUsd": 0.00015,
      "model": "gpt-4o-mini",
      "outputCostPer1kTokensUsd": 0.0006,
      "provider": "openai"
    },
    {
      "model": "gpt-5.4",
      "provider": "openai"
    }
  ]
} as const;
