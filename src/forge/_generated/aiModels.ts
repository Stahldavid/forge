// @forge-generated generator=0.1.0-alpha.1 input=15db5211b2295feba64a25a14ce8d07c783b9685e9994859941a0139d6f10d5d content=753dace69a5973055334425e5ad17fe09ca9a9d0bfa488f3444b267107bd23c3
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
      "inputCostPer1kTokensUsd": 0.0025,
      "model": "openai/gpt-4o",
      "outputCostPer1kTokensUsd": 0.01,
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
    }
  ]
} as const;
