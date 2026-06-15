# AI

ForgeOS treats AI as an explicit runtime capability, not an invisible side effect.

ForgeOS uses the Vercel AI SDK as the model/tool execution engine. ForgeOS adds
the app-native layer around it: generated contracts, runtime placement rules,
tenant/auth context, secret handling, telemetry, workflows, and deterministic
inspection for coding agents.

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

## Tools And Agents

Define AI-callable tools with `aiTool`:

```ts
import { aiTool } from "forge/server";
import { z } from "zod";

export const lookupTicket = aiTool({
  description: "Look up a support ticket summary.",
  inputSchema: z.object({ ticketId: z.string() }),
  outputSchema: z.object({ title: z.string() }),
  risk: "read",
  strict: true,
  needsApproval: false,
  handler: async (ctx, args) => {
    ctx.telemetry?.capture("tool.lookupTicket", { ticketId: args.ticketId });
    return { title: args.ticketId };
  },
});
```

Define reusable agents with `agent`:

```ts
import { agent } from "forge/server";
import { lookupTicket } from "./lookupTicket";

export const supportAgent = agent({
  provider: "gateway",
  model: "openai/gpt-5.4",
  instructions: "Answer support questions with project-safe tools.",
  tools: { lookupTicket },
  stopWhen: { kind: "stepCount", maxSteps: 6 },
});
```

Run agents through Forge runtime context:

```ts
const result = await ctx.agent.run({
  provider: "gateway",
  model: "openai/gpt-5.4",
  instructions: "Answer support questions with project-safe tools.",
  prompt: "Summarize ticket T-123.",
  tools: { lookupTicket },
  maxSteps: 6,
});
```

During local development, `forge dev` exposes two agent endpoints.

Use the JSON endpoint for CLI tools, tests, repair loops, and other automation:

```bash
curl -X POST "$FORGE_URL/ai/agents/run" \
  -H "Content-Type: application/json" \
  -d '{"agent":"supportAgent","prompt":"Summarize open tickets","tools":["forge_query_listTickets"]}'
```

Use the UIMessage streaming endpoint for browser chat surfaces:

```ts
import { DefaultChatTransport } from "ai";
import { useChat } from "@ai-sdk/react";

const { messages, sendMessage, addToolApprovalResponse } = useChat({
  transport: new DefaultChatTransport({
    api: `${forgeUrl}/ai/agents/chat`,
    headers: {
      "x-forge-user-id": "dev-user",
      "x-forge-tenant-id": "dev-tenant",
      "x-forge-role": "owner",
    },
    body: {
      agent: "supportAgent",
      provider: "gateway",
      model: "openai/gpt-5.4",
      maxSteps: 8,
    },
  }),
});
```

Both endpoints build auto-tools from `src/forge/_generated/agentTools.json`, so
commands, queries, and liveQueries are visible to the agent through the same
Forge runtime surface used by the frontend. Query/liveQuery tools are read-only.
Command tools are marked with `needsApproval`, so chat UIs can require a human
approval before a write tool executes. Inspect a run with:

```bash
forge ai trace <traceId> --json
```

Do not build custom agent loops in app code. Use `ctx.agent.run` for agent-native
code, or `ctx.ai.runAgent` when working directly with the AI context. Both delegate
the loop to AI SDK `ToolLoopAgent` while Forge records telemetry and applies the
same runtime boundaries used by the rest of the app.

## Generated Context

Forge generated artifacts expose the AI surface to humans and coding agents:

- `src/forge/_generated/aiProviders.json`
- `src/forge/_generated/aiModels.json`
- `src/forge/_generated/aiRegistry.json`
- `src/forge/_generated/aiContext.ts`
- `src/forge/_generated/agentContract.json`

The agent contract includes provider names, model declarations, tools, agents,
runtime placement, and required secret names. It never includes secret values,
raw telemetry payloads, database rows, or private prompt payloads.

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
forge inspect agent-tools --json
forge ai tools --json
forge ai agents --json
forge ai trace <traceId> --json
forge make ai-chat support --dry-run --json
forge check --json
forge verify --strict
```

Use `forge inspect all --json` when an AI coding agent needs to understand where AI providers, secrets, actions, workflows, and runtime restrictions are declared.
