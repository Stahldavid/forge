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

## Setup

Add the AI integration and configure secrets:

```bash
forge add ai
forge generate
forge ai check --json
```

Configure secret **names** in `.env` (never commit values):

```env
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
AI_GATEWAY_API_KEY=...
```

Providers:

| Provider | Secret | Typical use |
|----------|--------|-------------|
| `openai` | `OPENAI_API_KEY` | Direct OpenAI models |
| `anthropic` | `ANTHROPIC_API_KEY` | Direct Anthropic models |
| `gateway` | `AI_GATEWAY_API_KEY` | Vercel AI Gateway routing |

At runtime, Forge resolves secrets through `ctx.secrets`. Do not read `process.env` directly from app handlers.

## Simple Generation (no agent loop)

Most apps start here: **your code reads data**, then calls `ctx.ai` with a prompt. The model does not access the database directly — you pass the context you want it to see.

Use this in **workflow steps** or **actions** after commit:

```ts
step("triageWithAI", async (ctx) => {
  const ticket = await ctx.db.tickets.get(ticketId);

  const result = await ctx.ai.generateText({
    provider: "openai",
    model: "gpt-4o-mini",
    prompt: `Classify urgency for: ${ticket.title}`,
    system: "Reply with one word: urgent or normal.",
    purpose: "ticket_triage",
  });

  return { classification: result.text, usage: result.usage };
});
```

Other methods:

| Method | Use when |
|--------|----------|
| `ctx.ai.generateText` | Classification, summarization, free-form text |
| `ctx.ai.streamText` | Long responses streamed to logs or clients |
| `ctx.ai.generateStructured` | Typed JSON output with a Zod schema |

Typical flow:

```txt
command  -> ctx.db + ctx.emit("ticket.created")
workflow -> load ticket from ctx.db
         -> ctx.ai.generateText({ prompt: ... })
         -> save result / telemetry
```

See [Runtime Model](runtime-model.md) for why AI must not run inside commands.

### Mock mode (dev and CI)

Avoid real provider calls during development:

```bash
FORGE_MOCK_AI=1 forge dev
forge dev --mock-ai
forge ai test --provider openai --model gpt-4o-mini --prompt "hello" --mock
```

Mock mode returns deterministic placeholder text and usage without network access.

## Simple vs agents — when to use which

```txt
Need one answer from data you already loaded?
  -> ctx.ai.generateText / generateStructured in a workflow step

Need the model to choose among multiple app operations?
  -> ctx.agent.run with aiTool definitions + auto-tools

Need a chat UI in the browser?
  -> forge make ai-chat + /ai/agents/chat endpoint
```

| Approach | Model sees DB directly? | Best for |
|----------|-------------------------|----------|
| `generateText` + prompt | No — you pass context | Triage, summary, classification |
| `generateStructured` + Zod | No | Extract typed fields |
| `ctx.agent.run` + tools | Only via tool calls you define | Support bots, multi-step tasks |

### Structured output example

```ts
import { z } from "zod";

const triageSchema = z.object({
  priority: z.enum(["low", "medium", "high"]),
  category: z.string(),
  summary: z.string(),
});

step("classifyTicket", async (ctx) => {
  const ticket = await ctx.db.tickets.get(ticketId);

  const result = await ctx.ai.generateStructured({
    provider: "openai",
    model: "gpt-4o-mini",
    prompt: `Classify: ${ticket.title}\n${ticket.body ?? ""}`,
    schema: triageSchema,
    purpose: "ticket_triage_structured",
  });

  return result; // typed: { priority, category, summary }
});
```

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

## Why Forge tools instead of ad hoc tools

Forge tools run through the same app boundaries as the rest of the runtime.

| Ad hoc tool loop | Forge agent tools |
|------------------|-------------------|
| Tool names and schemas live in custom code | Tools are declared with `aiTool` or generated from runtime entries |
| Approval rules are hand-written | Commands default to approval-required write tools |
| Database access can bypass policies | Tools run with Forge auth, tenant scope, policies, and telemetry |
| Tool inventory is hard to inspect | `agentTools.json`, `agentTools.md`, and `forge ai tools --json` list the surface |
| Debugging depends on custom logs | `forge ai trace <traceId> --json` inspects runs |

Use ad hoc provider calls for simple generation when your code already loaded the context. Use Forge agent tools when the model must choose among app operations.

Define reusable agents with `agent`:

```ts
import { agent } from "forge/server";
import { lookupTicket } from "./lookupTicket";

export const supportAgent = agent({
  provider: "gateway",
  model: "openai/gpt-4o-mini",
  instructions: "Answer support questions with project-safe tools.",
  tools: { lookupTicket },
  stopWhen: { kind: "stepCount", maxSteps: 6 },
});
```

Run agents through Forge runtime context:

```ts
const result = await ctx.agent.run({
  provider: "gateway",
  model: "openai/gpt-4o-mini",
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
  -H "x-forge-user-id: dev-user" \
  -H "x-forge-tenant-id: dev-tenant" \
  -H "x-forge-role: owner" \
  -d '{"agent":"supportAgent","prompt":"Summarize open tickets","tools":["forge_query_listTickets"]}'
```

In local `dev-headers` mode, include the `x-forge-*` headers shown above unless your app configures another auth mode.

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
      model: "openai/gpt-4o-mini",
      maxSteps: 8,
    },
  }),
});
```

Both endpoints build auto-tools from `src/forge/_generated/agentTools.json`, so
commands, queries, and liveQueries are visible to the agent through the same
Forge runtime surface used by the frontend.

| Auto-tool kind | Behavior |
|----------------|----------|
| Query / liveQuery | Read-only; no approval required |
| Command | Marked `needsApproval`; chat UIs should confirm before executing writes |

Command tools still run through Forge runtime boundaries (auth, tenant scope, policies). They are not a bypass around the command/action model — prefer emitting events from commands and letting workflows/actions own side effects when possible.

Inspect a run with:

```bash
forge ai trace <traceId> --json
```

Do not build custom agent loops in app code. Use `ctx.agent.run` for agent-native
code, or `ctx.ai.runAgent` when working directly with the AI context. Both delegate
the loop to AI SDK `ToolLoopAgent` while Forge records telemetry and applies the
same runtime boundaries used by the rest of the app.

## Tool risk and approval

Every `aiTool` should declare **`risk`** and whether it **`needsApproval`**:

| `risk` | Meaning | Typical `needsApproval` |
|--------|---------|-------------------------|
| `read` | Read-only app data | `false` |
| `write` | Mutates app state | `true` or conditional |
| `external` | Calls external network/API | `true` |
| `destructive` | Deletes or irreversible ops | `true` |

Forge derives defaults from `risk`, but you can override:

```ts
export const deleteTicket = aiTool({
  description: "Delete a ticket permanently.",
  inputSchema: z.object({ id: z.string() }),
  risk: "destructive",
  needsApproval: true,
  handler: async (ctx, args) => {
    await ctx.db.tickets.delete(args.id);
    return { deleted: true };
  },
});
```

Auto-tools from commands inherit **`needsApproval: true`** for writes. Query/liveQuery auto-tools stay read-only.

Chat UIs must call `addToolApprovalResponse` (AI SDK UI) before Forge executes an approved write tool.

## Agent loop limits

Always set explicit **`stopWhen`** / **`maxSteps`** — never rely on unbounded loops:

```ts
export const supportAgent = agent({
  provider: "gateway",
  model: "openai/gpt-4o-mini",
  instructions: "Use tools when needed, then finish.",
  tools: { lookupTicket },
  stopWhen: { kind: "stepCount", maxSteps: 8 },
});
```

Forge delegates to AI SDK `ToolLoopAgent` with the same limits.

## Scaffold chat UI

Generate an agent definition plus React chat component:

```bash
forge make ai-chat support --dry-run --json
forge make ai-chat support --yes
forge generate
```

Creates:

- `src/ai/supportAgent.ts` — agent export
- `web/components/SupportAiChat.tsx` — chat UI wired to `/ai/agents/chat`

See [Authoring](authoring.md) and [Frontend](frontend.md).

## Telemetry and cost

Forge records AI events without retaining prompts/outputs by default:

```txt
forge.ai.generation.started / .completed / .failed
forge.ai.agent.started / .completed
forge.ai.usage
```

Results include `usage` (tokens) and `estimatedCostUsd` when model pricing is known.

Inspect runs:

```bash
forge ai trace <traceId> --json
```

## MCP (roadmap)

ForgeOS does not yet ship first-class MCP server import in public docs. The runtime uses **AI SDK v6**, which supports MCP clients for future integration.

Planned direction:

```txt
forge inspect tools --mcp
forge agent import-mcp <server>
```

Until then, define **`aiTool`** handlers for app-specific data access.

## Generated Context

Forge generated artifacts expose the AI surface to humans and coding agents:

- `src/forge/_generated/aiProviders.json`
- `src/forge/_generated/aiModels.json`
- `src/forge/_generated/aiRegistry.json`
- `src/forge/_generated/agentTools.json`
- `src/forge/_generated/agentTools.md`
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
