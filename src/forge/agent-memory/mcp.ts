import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DeltaStore } from "../delta/store.ts";
import { buildAgentMemoryContext } from "./context-pack.ts";
import { ingestEnvelope } from "./bridge.ts";
import { normalizeAgentEvent } from "./normalize.ts";

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export async function handleMcpRequest(workspaceRoot: string, request: JsonRpcRequest): Promise<Record<string, unknown> | null> {
  if (request.method.startsWith("notifications/")) {
    return null;
  }
  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "forgeos-agent-memory", version: "0.1.0" },
      });
    }
    if (request.method === "tools/list") {
      return response(request.id, {
        tools: [
          {
            name: "agent_context",
            description: "Read the ForgeOS Agent Memory context pack for the current work or a runtime entry.",
            inputSchema: {
              type: "object",
              properties: { entry: { type: "string" } },
              additionalProperties: false,
            },
          },
          {
            name: "agent_memory",
            description: "List recent redacted agent memory events.",
            inputSchema: {
              type: "object",
              properties: { target: { type: "string" }, limit: { type: "number" } },
              additionalProperties: false,
            },
          },
          {
            name: "timeline",
            description: "Read the semantic timeline for an entry, file, policy, service, tool, or agent.",
            inputSchema: {
              type: "object",
              properties: { target: { type: "string" }, limit: { type: "number" } },
              required: ["target"],
              additionalProperties: false,
            },
          },
          {
            name: "inspect_all",
            description: "Read the generated ForgeOS machine contract artifacts that are safe for agents.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      });
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown>
        : {};
      const result = await runTool(workspaceRoot, name, args);
      await logMcpToolCall(workspaceRoot, name, args, "completed").catch(() => undefined);
      return response(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    }
    return response(request.id, null, { code: -32601, message: `unknown MCP method: ${request.method}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response(request.id, null, { code: -32000, message });
  }
}

export async function runMcpServe(workspaceRoot: string): Promise<number> {
  let buffer = "";
  let sawFramedMessage = false;
  for await (const chunk of process.stdin) {
    buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const parsed = parseMcpFrames(buffer);
    buffer = parsed.remainder;
    if (parsed.requests.length > 0) {
      sawFramedMessage = true;
    }
    for (const request of parsed.requests) {
      const result = await handleMcpRequest(workspaceRoot, request);
      if (result) {
        writeMcpMessage(result);
      }
    }
  }
  const leftover = buffer.trim();
  if (!sawFramedMessage && leftover.startsWith("{")) {
    const result = await handleMcpRequest(workspaceRoot, JSON.parse(leftover) as JsonRpcRequest);
    if (result) {
      writeMcpMessage(result);
    }
  }
  return 0;
}

async function runTool(workspaceRoot: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "agent_context") {
    return buildAgentMemoryContext({
      workspaceRoot,
      entry: typeof args.entry === "string" ? args.entry : undefined,
    });
  }
  if (name === "agent_memory") {
    const store = await DeltaStore.open(workspaceRoot, { access: "read" });
    try {
      return {
        ok: true,
        events: await store.listAgentMemoryEvents({
          target: typeof args.target === "string" ? args.target : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }),
      };
    } finally {
      await store.close();
    }
  }
  if (name === "timeline") {
    const target = typeof args.target === "string" ? args.target : undefined;
    if (!target) {
      throw new Error("timeline requires target");
    }
    const store = await DeltaStore.open(workspaceRoot, { access: "read" });
    try {
      return {
        ok: true,
        timeline: await store.semanticTimeline({
          target,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }),
      };
    } finally {
      await store.close();
    }
  }
  if (name === "inspect_all") {
    return readInspectAll(workspaceRoot);
  }
  throw new Error(`unknown ForgeOS MCP tool: ${name}`);
}

async function logMcpToolCall(workspaceRoot: string, toolName: string, args: Record<string, unknown>, status: string): Promise<void> {
  const envelope = normalizeAgentEvent({
    workspaceRoot,
    source: "generic",
    integration: "mcp",
    eventName: "tool.call",
    raw: {
      toolName,
      args,
      status,
      timestamp: new Date().toISOString(),
    },
  });
  await ingestEnvelope(workspaceRoot, envelope);
}

function readInspectAll(workspaceRoot: string): Record<string, unknown> {
  const generated = join(workspaceRoot, "src", "forge", "_generated");
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(generated, name), "utf8")) as unknown;
    } catch {
      return null;
    }
  };
  return {
    ok: true,
    agentContract: read("agentContract.json"),
    agentTools: read("agentTools.json"),
    runtimeGraph: read("runtimeGraph.json"),
    policyRegistry: read("policyRegistry.json"),
  };
}

function response(id: JsonRpcRequest["id"], result: unknown, error?: Record<string, unknown>): Record<string, unknown> {
  return error ? { jsonrpc: "2.0", id: id ?? null, error } : { jsonrpc: "2.0", id: id ?? null, result };
}

function parseMcpFrames(raw: string): { requests: JsonRpcRequest[]; remainder: string } {
  const messages: JsonRpcRequest[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const headerEnd = raw.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) {
      break;
    }
    const header = raw.slice(cursor, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const body = raw.slice(bodyStart, bodyStart + length);
    messages.push(JSON.parse(body) as JsonRpcRequest);
    cursor = bodyStart + length;
  }
  return { requests: messages, remainder: raw.slice(cursor) };
}

function writeMcpMessage(message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
