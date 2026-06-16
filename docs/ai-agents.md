# AI Agents

ForgeOS supports native app agents on top of the Vercel AI SDK runtime.

Use simple `ctx.ai.generateText` or `ctx.ai.generateStructured` when your code already has the context and needs one model answer. Use agents when the model must choose among tools, perform multi-step work, or drive a chat surface.

## Runtime placement

AI agents may run in:

- actions;
- workflows;
- endpoints;
- server-only code.

They must not run in:

- commands;
- queries;
- liveQueries;
- frontend code.

Commands should write data and emit events. Actions and workflows should run AI after commit.

## Define a tool

```ts
import { aiTool } from "forge/server";
import { z } from "zod";

export const lookupTicket = aiTool({
  description: "Look up a support ticket summary.",
  inputSchema: z.object({ ticketId: z.string() }),
  outputSchema: z.object({ title: z.string(), status: z.string() }),
  risk: "read",
  needsApproval: false,
  handler: async (ctx, input) => {
    const ticket = await ctx.db.tickets.get(input.ticketId);
    return { title: ticket.title, status: ticket.status };
  },
});
```

Tools run through Forge context, so auth, tenant scope, policies, secrets, and telemetry remain part of the app boundary.

## Define an agent

```ts
import { agent } from "forge/server";
import { lookupTicket } from "./lookupTicket";

export const supportAgent = agent({
  provider: "gateway",
  model: "openai/gpt-4o-mini",
  instructions: "Answer support questions using safe app tools.",
  tools: { lookupTicket },
  stopWhen: { kind: "stepCount", maxSteps: 6 },
});
```

Always set step limits. Do not rely on unbounded tool loops.

## Run an agent

```ts
const result = await ctx.agent.run({
  agent: "supportAgent",
  prompt: "Summarize ticket T-123.",
  maxSteps: 6,
});
```

`ctx.ai.runAgent` is also available when working directly with the AI context.

## Auto-tools

Forge can expose commands, queries, and liveQueries as generated tools:

| Runtime entry | Tool behavior |
|---------------|---------------|
| Query | Read-only, no approval required |
| LiveQuery | Read-only, no approval required |
| Command | Write tool, approval required by default |

Inspect:

```bash
forge inspect agent-tools --json
forge ai tools --json
forge ai agents --json
```

## Dev endpoints

The dev server exposes:

| Endpoint | Use |
|----------|-----|
| `POST /ai/agents/run` | JSON automation, tests, scripts |
| `POST /ai/agents/chat` | AI SDK UIMessage streaming for chat UIs |

Local dev headers are required in `dev-headers` mode.

## Chat UI

Scaffold a chat surface:

```bash
forge make ai-chat support --dry-run --json
forge make ai-chat support --yes
forge generate
```

This creates an agent definition and a web chat component wired to the agent endpoint.

## Trace and debug

```bash
forge ai trace <traceId> --json
forge repair diagnose --from-last-test-run --json
```

Forge records AI telemetry without retaining prompts or outputs by default.

## Related pages

- [AI](ai.md)
- [Threat Model](threat-model.md)
- [Runtime by Example](runtime-by-example.md)
- [Agent Contract](agent-contract.md)
- [Frontend Integration Guide](frontend-integration-guide.md)
