# AI

ForgeOS treats AI as an explicit runtime capability, not an invisible side effect.

AI calls belong in side-effect-capable contexts:

- actions
- workflows
- endpoints
- server-only code

AI calls do not belong in deterministic runtime entries:

- commands
- queries
- liveQueries

## Runtime Rule

Commands are transactional and deterministic. They may write to `ctx.db` and emit events through `ctx.emit`, but they should not call model providers directly. Use an action or workflow step after commit when a feature needs generation, classification, summarization, or tool calls.

Queries and liveQueries are read-only. They should not call `ctx.ai`, access secrets, mutate state, or depend on network provider latency.

## Generated Context

Forge generated artifacts expose the AI surface to humans and coding agents:

- `src/forge/_generated/aiProviders.json`
- `src/forge/_generated/aiModels.json`
- `src/forge/_generated/aiRegistry.json`
- `src/forge/_generated/aiContext.ts`
- `src/forge/_generated/agentContract.json`

The agent contract includes provider names, model declarations, runtime placement, and required secret names. It never includes secret values, raw telemetry payloads, database rows, or private prompt payloads.

## Secrets

Use secret names in source and generated metadata:

```txt
OPENAI_API_KEY
ANTHROPIC_API_KEY
AI_GATEWAY_API_KEY
```

At runtime, access secrets through Forge context APIs. Do not read `process.env` directly from commands, queries, liveQueries, or frontend code.

## Typical Pattern

```txt
command
  -> validates input
  -> writes transactional data
  -> emits event

action/workflow
  -> runs after commit
  -> loads required data
  -> calls ctx.ai/provider
  -> writes result
```

This keeps user-facing writes fast, retryable, auditable, and safe for tenant isolation.

## Useful Commands

```bash
forge inspect ai --json
forge inspect all --json
forge check --json
forge verify --strict
```

Use `forge inspect all --json` when an AI coding agent needs to understand where AI providers, secrets, actions, workflows, and runtime restrictions are declared.
