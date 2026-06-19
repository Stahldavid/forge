import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runAgentMemoryCommand } from "../../src/forge/agent-memory/bridge.ts";
import { normalizeAgentEvent } from "../../src/forge/agent-memory/normalize.ts";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { DeltaStore } from "../../src/forge/delta/store.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

describe("H48 agent memory bridge", () => {
  test("normalizes external hook events without storing raw prompts or tool args", () => {
    const root = tempWorkspace("h48-normalize");
    try {
      const envelope = normalizeAgentEvent({
        workspaceRoot: root,
        source: "codex",
        eventName: "UserPromptSubmit",
        raw: {
          session_id: "codex-session-1",
          prompt: "Import billing service with sk_h48_canary_secret_123456",
          args: { apiKey: "sk_h48_canary_secret_123456" },
          model: "gpt-test",
        },
      });

      const serialized = JSON.stringify(envelope);
      expect(envelope.schema).toBe("forge.agent-event.v1");
      expect(envelope.event.kind).toBe("agent.prompt.submitted");
      expect(envelope.privacy.rawPromptStored).toBe(false);
      expect(envelope.privacy.rawToolArgsStored).toBe(false);
      expect(serialized).not.toContain("sk_h48_canary_secret_123456");
      expect(serialized).not.toContain("Import billing service with");
      expect(serialized).toContain("promptHash");
      expect(serialized).toContain("argsHash");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("ingests events into DeltaDB and builds entry context", async () => {
    const root = tempWorkspace("h48-ingest");
    try {
      const ingest = await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PreToolUse",
        input: {
          session_id: "codex-session-2",
          toolName: "forge.manifest_import",
          args: { entryName: "billing.createInvoice", token: "sk_h48_canary_secret_abcdef" },
          entries: ["billing.createInvoice"],
        },
      });
      expect(ingest.exitCode).toBe(0);
      expect(JSON.stringify(ingest)).not.toContain("sk_h48_canary_secret_abcdef");

      const context = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        target: "generic",
        entry: "billing.createInvoice",
      });
      expect("agentMemory" in context).toBe(true);
      if ("agentMemory" in context) {
        expect(context.agentMemory.entries).toContain("billing.createInvoice");
        expect(context.agentMemory.toolCalls.some((call) => call.tool === "forge.manifest_import")).toBe(true);
      }

      const store = await DeltaStore.open(root);
      const timeline = await store.semanticTimeline({ target: "tool:forge.manifest_import" });
      await store.close();
      expect(timeline.events.some((event) => event.kind === "agent.tool.requested")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extracts useful metadata from real Codex hook wire format without storing raw payloads", async () => {
    const root = tempWorkspace("h48-codex-wire");
    try {
      const ingest = await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PostToolUse",
        input: {
          session_id: "codex-session-3",
          turn_id: "turn-3",
          hook_event_name: "PostToolUse",
          permission_mode: "acceptEdits",
          cwd: root,
          tool_name: "Bash",
          tool_use_id: "toolu_3",
          tool_input: {
            command: "forge run billing.createInvoice --args '{\"apiKey\":\"sk_h48_real_wire_secret\"}'",
          },
          tool_response: {
            exitCode: 0,
            stdout: "created invoice inv_123 with sk_h48_real_wire_secret",
          },
        },
      });
      expect(ingest.exitCode).toBe(0);
      expect("envelope" in ingest).toBe(true);
      expect("event" in ingest).toBe(true);
      if (!("envelope" in ingest) || !("event" in ingest)) {
        throw new Error("expected ingest result");
      }
      const serialized = JSON.stringify(ingest);
      expect(serialized).not.toContain("sk_h48_real_wire_secret");
      expect(serialized).not.toContain("\"tool_input\":{\"command\"");
      expect(serialized).not.toContain("\"tool_response\":{\"exitCode\"");
      expect(ingest.envelope?.payload).toMatchObject({
        toolName: "Bash",
        toolUseId: "toolu_3",
        permissionMode: "acceptEdits",
        commandStored: false,
        commandKind: "shell",
        resultStatus: "success",
        exitCode: 0,
        responseStored: false,
      });
      expect(ingest.envelope?.payload.commandHash).toBeTruthy();
      expect(ingest.envelope?.payload.commandSummary).toContain("forge run billing.createInvoice");
      expect(ingest.envelope?.payload.responseSummary).toContain("created invoice");
      expect(ingest.event?.data.bindings).toMatchObject({
        toolName: "Bash",
        command: expect.stringContaining("forge run billing.createInvoice"),
        exitCode: 0,
        entries: ["billing.createInvoice"],
        status: "completed",
      });

      const context = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        target: "generic",
        entry: "billing.createInvoice",
      });
      expect("agentMemory" in context).toBe(true);
      if ("agentMemory" in context) {
        expect(context.agentMemory.entries).toContain("billing.createInvoice");
        expect(context.agentMemory.toolCalls.some((call) => call.tool === "Bash" && call.status === "completed")).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("extracts approval and apply_patch file metadata from Codex hook inputs", async () => {
    const root = tempWorkspace("h48-codex-approval");
    try {
      const ingest = await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PermissionRequest",
        input: {
          session_id: "codex-session-4",
          turn_id: "turn-4",
          hook_event_name: "PermissionRequest",
          tool_name: "apply_patch",
          tool_use_id: "toolu_4",
          tool_input: {
            description: "Edit source files",
            command: "*** Begin Patch\n*** Update File: src/commands/createInvoice.ts\n@@\n-old\n+new\n*** End Patch",
          },
        },
      });
      expect(ingest.exitCode).toBe(0);
      expect("envelope" in ingest).toBe(true);
      expect("event" in ingest).toBe(true);
      if (!("envelope" in ingest) || !("event" in ingest)) {
        throw new Error("expected ingest result");
      }
      expect(ingest.envelope?.payload).toMatchObject({
        toolName: "apply_patch",
        toolUseId: "toolu_4",
        commandKind: "patch",
        commandStored: false,
        approvalDescriptionSummary: "Edit source files",
      });
      expect(ingest.event?.data.bindings).toMatchObject({
        files: ["src/commands/createInvoice.ts"],
        status: "requested",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("installs Cursor via MCP and rules without private state hooks", async () => {
    const root = tempWorkspace("h48-cursor-install");
    try {
      const result = await runAgentMemoryCommand({
        subcommand: "install",
        workspaceRoot: root,
        json: true,
        target: "cursor",
      });
      expect(result.exitCode).toBe(0);
      expect("filesWritten" in result ? result.filesWritten : []).toEqual([
        ".cursor/mcp.json",
        ".cursor/rules/forgeos-agent-memory.mdc",
      ]);
      const mcp = readFileSync(join(root, ".cursor", "mcp.json"), "utf8");
      const rule = readFileSync(join(root, ".cursor", "rules", "forgeos-agent-memory.mdc"), "utf8");
      expect(mcp).toContain("\"forgeos\"");
      expect(rule).toContain("Do not ask ForgeOS to read Cursor internal chats");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("serves MCP tools and records MCP tool calls", async () => {
    const root = tempWorkspace("h48-mcp");
    try {
      const initialized = await handleMcpRequest(root, { jsonrpc: "2.0", id: 1, method: "initialize" });
      expect(initialized?.result).toBeTruthy();

      const listed = await handleMcpRequest(root, { jsonrpc: "2.0", id: 2, method: "tools/list" });
      expect(JSON.stringify(listed)).toContain("agent_context");

      const called = await handleMcpRequest(root, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "agent_context", arguments: { entry: "billing.createInvoice" } },
      });
      expect(JSON.stringify(called)).toContain("agentMemory");

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "agent_context" });
      await store.close();
      expect(events.some((event) => event.integrationKind === "mcp")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("parses H48 public commands", () => {
    expect(parseCli(["agent", "install", "codex", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "install", target: "codex", json: true },
    });
    expect(parseCli(["agent", "ingest", "claude-code", "--event", "PreToolUse"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "ingest", target: "claude-code", eventName: "PreToolUse" },
    });
    expect(parseCli(["agent", "context", "--current", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "context", current: true, json: true },
    });
    expect(parseCli(["mcp", "serve"]).command).toMatchObject({ kind: "mcp", subcommand: "serve" });
  });
});
