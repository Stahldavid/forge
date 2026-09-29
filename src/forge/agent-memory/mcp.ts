import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DeltaStore } from "../delta/store.ts";
import { ingestEnvelope, runAgentMemoryCommand } from "./bridge.ts";
import { normalizeAgentEvent } from "./normalize.ts";
import { requestLocalTask } from "../agent-fabric/local-task-server.ts";
import { LocalChangeReviewService } from "../agent-fabric/local-change-review-service.ts";

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
            name: "fabric_capabilities",
            description: "Read the current Agent Fabric coding-task capability boundary.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: "fabric_propose",
            description: "Submit an untrusted local coding task proposal to the running Agent Fabric owner. This does not approve or run it.",
            inputSchema: { type: "object", properties: { proposal: { type: "object" } },
              required: ["proposal"], additionalProperties: false },
          },
          {
            name: "fabric_status",
            description: "Read status and bounded evidence for a local coding task from the running Agent Fabric owner.",
            inputSchema: { type: "object", properties: { taskId: { type: "string" } },
              required: ["taskId"], additionalProperties: false },
          },
          {
            name: "fabric_evidence",
            description: "Read digest-bound task provenance without raw model output or diff content.",
            inputSchema: { type: "object", properties: { taskId: { type: "string" } },
              required: ["taskId"], additionalProperties: false },
          },
          {
            name: "fabric_change_propose",
            description: "Register a change request for independent review. The exact diff is pinned when the owner runs the reviewer; this tool does not start a paid reviewer or approve the change.",
            inputSchema: { type: "object", properties: { request: {
              type: "object",
              properties: { objective: { type: "string" }, acceptanceCriteria: { type: "array", items: { type: "string" } },
                implementer: { type: "string" } },
              required: ["objective", "acceptanceCriteria", "implementer"], additionalProperties: false,
            } }, required: ["request"], additionalProperties: false },
          },
          {
            name: "fabric_change_status",
            description: "Read the current state of a pinned change review without starting a reviewer.",
            inputSchema: { type: "object", properties: { changeId: { type: "string" } },
              required: ["changeId"], additionalProperties: false },
          },
          {
            name: "fabric_change_evidence",
            description: "Read exact-diff and review evidence for a pinned change without starting a reviewer.",
            inputSchema: { type: "object", properties: { changeId: { type: "string" } },
              required: ["changeId"], additionalProperties: false },
          },
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
        ...(result && typeof result === "object" && "ok" in result && result.ok === false ? { isError: true } : {}),
      });
    }
    return response(request.id, null, { code: -32601, message: `unknown MCP method: ${request.method}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response(request.id, null, { code: -32000, message });
  }
}

export async function runMcpServe(workspaceRoot: string): Promise<number> {
  let buffer: Buffer = Buffer.alloc(0);
  let sawFramedMessage = false;
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
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
  const leftover = buffer.toString("utf8").trim();
  if (!sawFramedMessage && leftover.startsWith("{")) {
    const result = await handleMcpRequest(workspaceRoot, JSON.parse(leftover) as JsonRpcRequest);
    if (result) {
      writeMcpMessage(result);
    }
  }
  return 0;
}

async function runTool(workspaceRoot: string, name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === "fabric_capabilities") {
    if (Object.keys(args).length !== 0) throw new Error("fabric_capabilities accepts no arguments");
    return {
      ok: true,
      schemaVersion: 1,
      protocolKernel: "p0a_available",
      boundedModelAdapter: "p0b_a_available",
      codingTaskControl: "local_owner_service_required",
      ownerApproval: "local_popup_cli_only",
      cancellation: "owner_cli_only_best_effort",
      taskMutationTools: ["fabric_propose"],
      taskReadTools: ["fabric_status", "fabric_evidence"],
      changeMutationTools: ["fabric_change_propose"],
      changeReadTools: ["fabric_change_status", "fabric_change_evidence"],
      changeReviewDispatch: "owner_cli_only",
      cli: "forge fabric capabilities --json",
    };
  }
  if (name === "fabric_propose" || name === "fabric_status" || name === "fabric_evidence") {
    const keys = Object.keys(args).sort().join(",");
    if (name === "fabric_propose" && keys !== "proposal") throw new Error("fabric_propose requires only proposal");
    if ((name === "fabric_status" || name === "fabric_evidence") &&
        (keys !== "taskId" || typeof args.taskId !== "string")) {
      throw new Error(`${name} requires only taskId`);
    }
    const status = await requestLocalTask(realpathSync(workspaceRoot),
      name === "fabric_propose" ? "propose" : name === "fabric_evidence" ? "evidence" : "status", args);
    if (!status) throw new Error("Agent Fabric local owner is not running; start forge fabric serve");
    if (name === "fabric_evidence") {
      return { ok: true, taskId: status.taskId, state: status.state, provenance: status.provenance };
    }
    return { ok: true, status };
  }
  if (name === "fabric_change_propose" || name === "fabric_change_status" || name === "fabric_change_evidence") {
    const keys = Object.keys(args).sort().join(",");
    if (name === "fabric_change_propose" &&
        (keys !== "request" || !args.request || typeof args.request !== "object" || Array.isArray(args.request))) {
      throw new Error("fabric_change_propose requires only request");
    }
    if (name !== "fabric_change_propose" &&
        (keys !== "changeId" || typeof args.changeId !== "string" || args.changeId.length === 0)) {
      throw new Error(`${name} requires only changeId`);
    }
    const service = await LocalChangeReviewService.open(realpathSync(workspaceRoot));
    try {
      const result = name === "fabric_change_propose"
        ? await service.propose(args.request as Parameters<LocalChangeReviewService["propose"]>[0])
        : name === "fabric_change_status"
          ? await service.status(args.changeId as string)
          : await service.evidence(args.changeId as string);
      return { ok: true, ...(name === "fabric_change_evidence" ? { evidence: result } : { status: result }) };
    } finally {
      await service.close();
    }
  }
  if (name === "agent_context") {
    return runAgentMemoryCommand({
      subcommand: "context",
      workspaceRoot,
      json: true,
      entry: typeof args.entry === "string" ? args.entry : undefined,
    });
  }
  if (name === "agent_memory") {
    return runAgentMemoryCommand({
      subcommand: "memory",
      workspaceRoot,
      json: true,
      entry: typeof args.target === "string" ? args.target : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
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

function parseMcpFrames(raw: Buffer): { requests: JsonRpcRequest[]; remainder: Buffer } {
  const messages: JsonRpcRequest[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) {
      break;
    }
    const header = raw.subarray(cursor, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1024 * 1024) {
      throw new Error("Invalid MCP Content-Length");
    }
    if (raw.length - bodyStart < length) break;
    const body = raw.subarray(bodyStart, bodyStart + length).toString("utf8");
    messages.push(JSON.parse(body) as JsonRpcRequest);
    cursor = bodyStart + length;
  }
  return { requests: messages, remainder: raw.subarray(cursor) };
}

function writeMcpMessage(message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
