// @forge-generated generator=0.1.0-alpha.0 input=91d8894f322b8dd604714d7b26a8bac3b5bbb0904d62cc0e2761ba21098e1537 content=753dace69a5973055334425e5ad17fe09ca9a9d0bfa488f3444b267107bd23c3
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
