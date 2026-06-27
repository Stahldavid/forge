import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runAgentCommand } from "../../src/forge/agent-adapters/index.ts";
import { drainAgentMemoryQueueFile, formatAgentMemoryHuman, inspectAgentMemoryQueueFile, runAgentMemoryCommand } from "../../src/forge/agent-memory/bridge.ts";
import { probeCodexHookRunner } from "../../src/forge/agent-memory/hook-runner.ts";
import { codexInstallFiles } from "../../src/forge/agent-memory/sources/codex.ts";
import { normalizeAgentEvent } from "../../src/forge/agent-memory/normalize.ts";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { createAmbientDeltaRecorder } from "../../src/forge/delta/recorder.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

function markFrameworkCheckout(root: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "bin", "forge.mjs"), "#!/usr/bin/env node\n", "utf8");
}

function queuedCodexHookLine(root: string, eventName: string, sessionId: string): string {
  return JSON.stringify({
    forgeHookQueueV1: true,
    source: "codex",
    eventName,
    workspaceRoot: root,
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    raw: {
      session_id: sessionId,
      hook_event_name: eventName,
      tool_name: eventName === "PreToolUse" ? "shell" : undefined,
    },
  });
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
        expect(context.agentMemory.summary).toMatchObject({
          events: 1,
          toolCalls: 1,
          entries: 1,
          sources: ["codex"],
          tools: ["forge.manifest_import"],
        });
        expect(context.agentMemory.entries).toContain("billing.createInvoice");
        expect(context.agentMemory.toolCalls.some((call) => call.tool === "forge.manifest_import")).toBe(true);
        expect(context.agentMemory.events[0]?.entries).toContain("billing.createInvoice");
        expect(context.scope).toBe("entry");
        expect(context.scopeTarget).toMatchObject({
          kind: "entry",
          value: "billing.createInvoice",
          semanticTarget: "billing.createInvoice",
        });
        expect(JSON.stringify(context)).not.toContain("\"envelope\"");
        expect(JSON.stringify(context)).not.toContain("\"payload\"");
        const human = formatAgentMemoryHuman(context);
        expect(human).toContain("Forge Agent Context (entry: billing.createInvoice)");
        expect(human).toContain("target: entry billing.createInvoice");
        expect(human).toContain("events: 1");
        expect(human).toContain("tools: forge.manifest_import");
        expect(human).not.toContain("\"payload\"");
      }

      const handoffContext = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        target: "generic",
        handoff: true,
      });
      expect("agentMemory" in handoffContext).toBe(true);
      if ("agentMemory" in handoffContext) {
        const state = handoffContext.currentState as { reasons?: Array<{ signal?: string; weight?: number; value?: string }> };
        expect(handoffContext.scope).toBe("handoff");
        expect(handoffContext.scopeTarget.kind).toBe("handoff");
        expect(state.reasons?.some((reason) => reason.signal && reason.weight !== undefined)).toBe(true);
        expect(handoffContext.recommendedCommands).toContain("forge handoff --json");
      }

      const memory = await runAgentMemoryCommand({
        subcommand: "memory",
        workspaceRoot: root,
        json: true,
        target: "generic",
        entry: "billing.createInvoice",
      });
      expect("events" in memory).toBe(true);
      if ("events" in memory && memory.ok) {
        expect(memory.events[0]?.data.envelope).toBeTruthy();
        expect(JSON.stringify(memory)).toContain("\"payload\"");
        expect(JSON.stringify(memory)).not.toContain("sk_h48_canary_secret_abcdef");
        const memoryHuman = formatAgentMemoryHuman(memory);
        expect(memoryHuman).toContain("Forge Agent Memory");
        expect(memoryHuman).toContain("events: 1");
        expect(memoryHuman).toContain("tools: forge.manifest_import");
        expect(memoryHuman).toContain("entries: billing.createInvoice");
        expect(memoryHuman).not.toContain("\"payload\"");
        expect(memoryHuman).not.toContain("sk_h48_canary_secret_abcdef");
      }

      const store = await DeltaStore.open(root);
      const timeline = await store.semanticTimeline({ target: "tool:forge.manifest_import" });
      await store.close();
      expect(timeline.events.some((event) => event.kind === "agent.tool.requested")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
  }, 90_000);

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
  }, 30_000);

  test("agent timeline summarizes external agent hook activity", async () => {
    const root = tempWorkspace("h48-agent-timeline");
    try {
      await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PreToolUse",
        input: {
          session_id: "codex-session-5",
          turn_id: "turn-5",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_use_id: "toolu_5",
          tool_input: {
            command: "forge check --json && echo sk_h48_timeline_secret",
          },
        },
      });
      await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PermissionRequest",
        input: {
          session_id: "codex-session-5",
          turn_id: "turn-6",
          hook_event_name: "PermissionRequest",
          tool_name: "apply_patch",
          tool_use_id: "toolu_6",
          tool_input: {
            command: "*** Begin Patch\n*** Update File: src/commands/payInvoice.ts\n@@\n-old\n+new\n*** End Patch",
          },
        },
      });

      const timeline = await runAgentCommand({
        subcommand: "timeline",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });

      expect("timeline" in timeline).toBe(true);
      if (!("timeline" in timeline)) {
        throw new Error("expected agent timeline result");
      }
      expect(timeline.ok).toBe(true);
      expect(timeline.sourceFilter).toBe("codex");
      expect(timeline.summary.events).toBe(2);
      expect(timeline.sessions).toContain("codex-session-5");
      expect(timeline.files).toContain("src/commands/payInvoice.ts");
      expect(timeline.events.some((event) => event.toolName === "Bash" && event.command?.includes("forge check --json"))).toBe(true);
      expect(timeline.events.some((event) => event.status === "requested")).toBe(true);
      expect(JSON.stringify(timeline)).not.toContain("sk_h48_timeline_secret");
      expect(timeline.nextActions).toContain("forge agent context --current --json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("agent timeline localizes next actions without rewriting recorded command history", async () => {
    const root = tempWorkspace("h48-agent-timeline-local-cli");
    try {
      markFrameworkCheckout(root);
      await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        eventName: "PreToolUse",
        input: {
          session_id: "codex-session-local",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: { command: "forge check --json" },
        },
      });

      const timeline = await runAgentCommand({
        subcommand: "timeline",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });

      expect("timeline" in timeline).toBe(true);
      if (!("timeline" in timeline)) {
        throw new Error("expected agent timeline result");
      }
      expect(timeline.nextActions).toContain("node bin/forge.mjs agent context --current --json");
      expect(timeline.nextActions).not.toContain("forge agent context --current --json");
      expect(timeline.events.some((event) => event.command === "forge check --json")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("agent timeline can read while another Delta writer is open", async () => {
    const root = tempWorkspace("h48-agent-timeline-read-while-open");
    let store: DeltaStore | null = null;
    try {
      store = await DeltaStore.open(root);
      const timeline = await runAgentCommand({
        subcommand: "timeline",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });

      expect("timeline" in timeline).toBe(true);
      if (!("timeline" in timeline)) {
        throw new Error("expected agent timeline result");
      }
      expect(timeline.ok).toBe(true);
      expect(timeline.exitCode).toBe(0);
      expect(timeline.summary.events).toBe(0);
      expect(timeline.diagnostics).toEqual([]);

      const context = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        current: true,
      });
      expect("agentMemory" in context).toBe(true);

      const memory = await runAgentMemoryCommand({
        subcommand: "memory",
        workspaceRoot: root,
        json: true,
        target: "codex",
        limit: 10,
      });
      expect("events" in memory).toBe(true);
      if (!("events" in memory)) {
        throw new Error("expected agent memory list result");
      }
      expect(memory.ok).toBe(true);
      expect(memory.exitCode).toBe(0);

      const hookStatus = await runAgentCommand({
        subcommand: "hooks",
        hookAction: "status",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });
      expect("checks" in hookStatus).toBe(true);
      if (!("checks" in hookStatus)) {
        throw new Error("expected hook status result");
      }
      expect(hookStatus.checks.find((check) => check.name === "agent-memory-readable")?.ok).toBe(true);
      expect(hookStatus.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_DELTA_BUSY")).toBe(false);

      const mcpContext = await handleMcpRequest(root, {
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "agent_context", arguments: { entry: "billing.createInvoice" } },
      });
      expect(JSON.stringify(mcpContext)).toContain("agentMemory");

      const mcpMemory = await handleMcpRequest(root, {
        jsonrpc: "2.0",
        id: 43,
        method: "tools/call",
        params: { name: "agent_memory", arguments: { target: "codex", limit: 10 } },
      });
      const mcpMemoryText = mcpToolText(mcpMemory);
      expect(mcpMemoryText).toContain("\"ok\": true");

      const mcpTimeline = await handleMcpRequest(root, {
        jsonrpc: "2.0",
        id: 44,
        method: "tools/call",
        params: { name: "timeline", arguments: { target: "tool:Bash", limit: 10 } },
      });
      const mcpTimelineText = mcpToolText(mcpTimeline);
      expect(mcpTimelineText).toContain("\"ok\": true");

      const smoke = await runAgentCommand({
        subcommand: "hooks",
        hookAction: "smoke",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });
      expect("ingestResult" in smoke).toBe(true);
      if (!("checks" in smoke) || !("diagnostics" in smoke) || !("nextActions" in smoke)) {
        throw new Error("expected hook smoke result");
      }
      expect(smoke.exitCode).toBe(1);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_DELTA_BUSY")).toBe(true);
      expect(JSON.stringify(smoke)).toContain("\"busy\"");
      expect(JSON.stringify(smoke)).toContain("\"relativeLockPath\":\".forge/delta/delta.lock\"");
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_AGENT_HOOK_CANARY_NOT_VISIBLE")).toBe(false);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_AGENT_HOOK_CANARY_MISSING")).toBe(false);
      expect(smoke.checks.find((check) => check.name === "canary-visible")?.message).toBe("not checked because canary ingest failed");
      expect(smoke.nextActions).toContain("forge delta status --json");
    } finally {
      if (store) {
        await store.close();
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 90_000);

  test("hook smoke falls back to bridge events while PGlite is held by a live dev runtime", async () => {
    const root = tempWorkspace("h48-pglite-bridge-fallback");
    try {
      mkdirSync(join(root, ".forge", "delta", "delta.db", "postmaster.pid"), { recursive: true });

      const smoke = await runAgentCommand({
        subcommand: "hooks",
        hookAction: "smoke",
        workspaceRoot: root,
        json: true,
        target: "codex",
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
        limit: 10,
      });

      expect("ingestResult" in smoke).toBe(true);
      if (!("checks" in smoke) || !("diagnostics" in smoke) || !("canary" in smoke)) {
        throw new Error("expected hook smoke result");
      }
      expect(smoke.exitCode).toBe(0);
      expect(smoke.deltaWritable).toBe(true);
      expect(smoke.visibleInMemory).toBe(true);
      expect(smoke.canarySignals).toBeGreaterThan(0);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_DELTA_BUSY")).toBe(false);
      expect(JSON.stringify(smoke.ingestResult)).toContain("\"reason\":\"pglite-active\"");
      expect(smoke.checks).toContainEqual({
        name: "canary-ingest",
        ok: true,
        message: "canary event was normalized and stored",
      });
      expect(smoke.checks.find((check) => check.name === "canary-visible")?.message).toBe("canary event is visible in agent memory");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test("ambient dev recorder releases the writer lock between events so agent queue ingest can write", async () => {
    const root = tempWorkspace("h48-dev-recorder-short-lock");
    try {
      const recorder = await createAmbientDeltaRecorder(root, "forge-dev", "forge dev");
      const lockPath = join(root, ".forge", "delta", "delta.lock");
      expect(existsSync(lockPath)).toBe(false);

      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "PostToolUse", "codex-session-dev-recorder"),
          "",
        ].join("\n"),
        "utf8",
      );

      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.busy).toBeUndefined();
      expect(drained.eventsIngested).toBe(1);

      await recorder.recordFileChanged("src/commands/createProject.ts");
      expect(existsSync(lockPath)).toBe(false);
      await recorder.close("forge dev stopped");
      expect(existsSync(lockPath)).toBe(false);

      const store = await DeltaStore.open(root, { access: "read" });
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(1);
      expect(events[0]?.externalSessionId).toBe("codex-session-dev-recorder");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test("installs Codex lightweight hook runner with short timeouts and NDJSON queue", async () => {
    const root = tempWorkspace("h48-codex-hook-install");
    try {
      const result = await runAgentMemoryCommand({
        subcommand: "install",
        workspaceRoot: root,
        json: true,
        target: "codex",
      });
      expect(result.exitCode).toBe(0);
      expect("filesPlanned" in result ? result.filesPlanned : []).toEqual([
        ".codex/hooks.json",
        ".forge/agent/codex-hook.mjs",
        ".forge/agent/codex-hook.meta.json",
      ]);

      const hooks = JSON.parse(readFileSync(join(root, ".codex", "hooks.json"), "utf8")) as {
        hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }> };
      };
      const preToolUse = hooks.hooks?.PreToolUse?.[0]?.hooks?.[0];
      expect(preToolUse?.command).toBe("node .forge/agent/codex-hook.mjs PreToolUse");
      expect(preToolUse?.timeout).toBe(2);

      const meta = JSON.parse(readFileSync(join(root, ".forge", "agent", "codex-hook.meta.json"), "utf8")) as {
        runner?: string;
        queueFile?: string;
      };
      expect(meta.runner).toBe(".forge/agent/codex-hook.mjs");
      expect(meta.queueFile).toBe(".forge/agent/events.ndjson");

      const probe = await probeCodexHookRunner(root);
      expect(probe.error, JSON.stringify(probe)).toBeUndefined();
      expect(probe.exitCode).toBe(0);
      expect(probe.queued).toBe(true);
      expect(probe.durationMs).toBeLessThan(5000);
      expect(probe.stdinHangSafe).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("codex install plan stays deterministic without workspace root", () => {
    const planned = codexInstallFiles().map((file) => file.path);
    expect(planned).toEqual([".codex/hooks.json", ".forge/agent/codex-hook.mjs"]);
  });

  test("codex hook runner probe fails when open stdin requires external timeout", async () => {
    const root = tempWorkspace("h48-codex-hook-hang");
    try {
      mkdirSync(join(root, ".forge", "agent"), { recursive: true });
      writeFileSync(
        join(root, ".forge", "agent", "codex-hook.mjs"),
        [
          "process.stdin.resume();",
          "setTimeout(() => undefined, 10000);",
          "",
        ].join("\n"),
        "utf8",
      );

      const probe = await probeCodexHookRunner(root, { maxDurationMs: 100, stdinHangBudgetMs: 200 });
      expect(probe.ok).toBe(false);
      expect(probe.stdinHangSafe).toBe(false);
      expect(probe.error).toContain("open stdin");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 10_000);

  test("codex hook runner queues redacted payloads instead of raw hook input", () => {
    const root = tempWorkspace("h48-codex-hook-redacted-queue");
    try {
      const runner = join(process.cwd(), "src", "forge", "agent-memory", "sources", "codex-hook-runner.mjs");
      const secret = "sk_h48_queue_secret_123456";
      const result = spawnSync("node", [runner, "PostToolUse"], {
        cwd: root,
        input: JSON.stringify({
          session_id: "codex-session-redacted-queue",
          hook_event_name: "PostToolUse",
          prompt: `do the publish with ${secret}`,
          tool_name: "Bash",
          tool_use_id: "toolu_redacted_queue",
          tool_input: {
            command: `forge run billing.createInvoice --args '{"apiKey":"${secret}"}'`,
          },
          tool_response: {
            exitCode: 0,
            stdout: `created invoice with ${secret}`,
          },
        }),
        encoding: "utf8",
        windowsHide: true,
      });
      expect(result.status).toBe(0);

      const queueFile = join(root, ".forge", "agent", "events.ndjson");
      const serialized = readFileSync(queueFile, "utf8");
      const [line] = serialized.trim().split(/\r?\n/u);
      const entry = JSON.parse(line ?? "{}") as Record<string, unknown>;
      const payload = entry.payload as Record<string, unknown>;

      expect(entry.raw).toBeUndefined();
      expect(entry.rawStored).toBe(false);
      expect(entry.payloadRedacted).toBe(true);
      expect(payload.commandStored).toBe(false);
      expect(payload.commandSummary).toContain("forge run billing.createInvoice");
      expect(payload.responseStored).toBe(false);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("do the publish");
      expect(serialized).not.toContain("\"tool_input\":{\"command\"");
      expect(serialized).not.toContain("\"tool_response\":{\"exitCode\"");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("drains Codex hook queue idempotently across watcher restarts", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-idempotent");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "SessionStart", "codex-session-restart-1"),
          queuedCodexHookLine(root, "PreToolUse", "codex-session-restart-1"),
          "",
        ].join("\n"),
        "utf8",
      );

      const first = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(first.errors).toEqual([]);
      expect(first.eventsIngested).toBe(2);

      const restarted = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(restarted.errors).toEqual([]);
      expect(restarted.eventsIngested).toBe(0);

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(2);
      expect(readFileSync(`${queueFile}.checkpoint.json`, "utf8")).toContain("\"offset\"");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("queue drain reports Delta busy without advancing the checkpoint", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-busy");
    let store: DeltaStore | null = null;
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "PostToolUse", "codex-session-busy"),
          "",
        ].join("\n"),
        "utf8",
      );

      store = await DeltaStore.open(root);
      const blocked = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(blocked.errors).toEqual([]);
      expect(blocked.busy?.code).toBe("FORGE_DELTA_BUSY");
      expect(blocked.eventsIngested).toBe(0);
      expect(existsSync(`${queueFile}.checkpoint.json`)).toBe(false);

      await store.close();
      store = null;
      const retried = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(retried.errors).toEqual([]);
      expect(retried.busy).toBeUndefined();
      expect(retried.eventsIngested).toBe(1);

      const readStore = await DeltaStore.open(root, { access: "read" });
      const events = await readStore.listAgentMemoryEvents({ target: "codex" });
      await readStore.close();
      expect(events).toHaveLength(1);
      expect(events[0]?.externalSessionId).toBe("codex-session-busy");
    } finally {
      if (store) {
        await store.close();
      }
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test("inspects and drains Codex hook queue with one-shot ingest", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-inspect");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "PostToolUse", "codex-session-inspect-1"),
          "",
        ].join("\n"),
        "utf8",
      );

      const inspected = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(inspected.exists).toBe(true);
      expect(inspected.events).toBe(1);
      expect(inspected.nativeSignals).toBe(1);
      expect(inspected.usefulSignals).toBe(1);

      const drained = await runAgentMemoryCommand({
        subcommand: "ingest",
        workspaceRoot: root,
        json: true,
        target: "codex",
        source: "codex",
        file: ".forge/agent/events.ndjson",
      });
      expect(drained.exitCode).toBe(0);
      expect("watch" in drained && drained.watch).toBe(false);
      expect("eventsIngested" in drained ? drained.eventsIngested : 0).toBe(1);

      const afterDrain = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(afterDrain.events).toBe(0);

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("skips probe, invalid, and out-of-workspace queued hook lines during drain", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-skip-noise");
    const otherRoot = tempWorkspace("h48-codex-hook-queue-skip-other");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "PostToolUse", "codex-session-skip-1"),
          JSON.stringify({
            forgeHookQueueV1: true,
            source: "codex",
            eventName: "SessionStart",
            workspaceRoot: root,
            raw: { forgeHookProbe: true },
          }),
          JSON.stringify({
            forgeHookQueueV1: true,
            source: "codex",
            eventName: "SessionStart",
            workspaceRoot: root,
            raw: { _parseError: true },
          }),
          queuedCodexHookLine(otherRoot, "PostToolUse", "codex-session-skip-other"),
          "",
        ].join("\n"),
        "utf8",
      );

      const inspected = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(inspected.events).toBe(1);
      expect(inspected.ignoredOutOfWorkspaceEvents).toBe(1);

      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(1);

      const afterDrain = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(afterDrain.events).toBe(0);

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(otherRoot, { recursive: true, force: true });
    }
  }, 30_000);

  test("bounds queued hook inspection while preserving recent useful signals", () => {
    const root = tempWorkspace("h48-codex-hook-queue-bounded-inspect");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const oldLargeLine = JSON.stringify({
        forgeHookQueueV1: true,
        source: "codex",
        eventName: "SessionStart",
        workspaceRoot: root,
        raw: {
          session_id: "codex-session-large-old",
          hook_event_name: "SessionStart",
          padding: "x".repeat(1024 * 1024 + 2048),
        },
      });
      writeFileSync(
        queueFile,
        [
          oldLargeLine,
          queuedCodexHookLine(root, "PostToolUse", "codex-session-large-recent"),
          "",
        ].join("\n"),
        "utf8",
      );

      const inspected = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(inspected.truncated).toBe(true);
      expect(inspected.skippedBytes).toBeGreaterThan(0);
      expect(inspected.events).toBe(1);
      expect(inspected.nativeSignals).toBe(1);
      expect(inspected.usefulSignals).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("queue drain waits for a short-lived Delta writer before reporting busy", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-waits");
    let store: DeltaStore | null = null;
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [
          queuedCodexHookLine(root, "PostToolUse", "codex-session-waits"),
          "",
        ].join("\n"),
        "utf8",
      );

      store = await DeltaStore.open(root);
      const delayedClose = setTimeout(() => {
        void store?.close().then(() => {
          store = null;
        });
      }, 100);
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      clearTimeout(delayedClose);
      expect(drained.errors).toEqual([]);
      expect(drained.busy).toBeUndefined();
      expect(drained.eventsIngested).toBe(1);

      const readStore = await DeltaStore.open(root, { access: "read" });
      const events = await readStore.listAgentMemoryEvents({ target: "codex" });
      await readStore.close();
      expect(events).toHaveLength(1);
      expect(events[0]?.externalSessionId).toBe("codex-session-waits");
    } finally {
      if (store) {
        await store.close();
      }
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("retains partial Codex hook queue line until newline completes it", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-partial");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const firstLine = queuedCodexHookLine(root, "SessionStart", "codex-session-partial-1");
      const secondLine = queuedCodexHookLine(root, "PostToolUse", "codex-session-partial-1");
      writeFileSync(queueFile, `${firstLine}\n${secondLine.slice(0, -8)}`, "utf8");

      const first = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(first.errors).toEqual([]);
      expect(first.eventsIngested).toBe(1);
      expect(first.pendingBytes).toBeGreaterThan(0);

      writeFileSync(queueFile, `${firstLine}\n${secondLine}\n`, "utf8");
      const completed = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(completed.errors).toEqual([]);
      expect(completed.eventsIngested).toBe(1);

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.eventKind).sort()).toEqual([
        "agent.session.started",
        "agent.tool.completed",
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("compacts consumed Codex hook queue lines into bounded local history", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-retention");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const secret = "sk_h48_history_secret_123456";
      const firstLine = JSON.stringify({
        forgeHookQueueV1: true,
        source: "codex",
        eventName: "PreToolUse",
        workspaceRoot: root,
        enqueuedAt: "2026-01-01T00:00:00.000Z",
        raw: {
          session_id: "codex-session-retention-1",
          hook_event_name: "PreToolUse",
          tool_name: "Bash",
          tool_input: {
            command: `forge run billing.createInvoice --args '{"apiKey":"${secret}"}'`,
          },
        },
      });
      const secondLine = queuedCodexHookLine(root, "PreToolUse", "codex-session-retention-1");
      const partialLine = queuedCodexHookLine(root, "PostToolUse", "codex-session-retention-1").slice(0, -4);
      writeFileSync(queueFile, `${firstLine}\n${secondLine}\n${partialLine}`, "utf8");

      const drained = await drainAgentMemoryQueueFile({
        workspaceRoot: root,
        watchFile: queueFile,
        source: "codex",
        compactAfterBytes: 1,
        historyMaxBytes: 4096,
      });

      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(2);
      expect(drained.compacted).toBe(true);
      expect(readFileSync(queueFile, "utf8")).toBe(partialLine);
      const history = readFileSync(drained.historyFile, "utf8");
      expect(history).toContain("codex-session-retention-1");
      expect(history).toContain("\"payloadRedacted\":true");
      expect(history).not.toContain(secret);
      expect(history).not.toContain("\"raw\":");
      expect(history).not.toContain("forge run billing.createInvoice --args");
      expect(readFileSync(`${queueFile}.checkpoint.json`, "utf8")).toContain("\"offset\": 0");

      const store = await DeltaStore.open(root);
      const events = await store.listAgentMemoryEvents({ target: "codex" });
      await store.close();
      expect(events).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
  }, 30_000);

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
    expect(parseCli(["agent", "context", "--change", "current", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "context", change: "current", entry: undefined, json: true },
    });
    expect(parseCli(["agent", "context", "--proof", "security-prove", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "context", proof: "security-prove", entry: undefined, json: true },
    });
    expect(parseCli(["agent", "context", "--handoff", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "context", handoff: true, entry: undefined, json: true },
    });
    expect(parseCli(["agent", "timeline", "--target", "codex", "--limit", "5", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "timeline", target: "codex", limit: 5, json: true },
    });
    expect(parseCli(["mcp", "serve"]).command).toMatchObject({ kind: "mcp", subcommand: "serve" });
  });

  test("returns explicit scope targets for change and proof context", async () => {
    const root = tempWorkspace("h48-context-scopes");
    try {
      const change = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        target: "generic",
        change: "current",
      });
      expect("agentMemory" in change).toBe(true);
      if ("agentMemory" in change) {
        expect(change.scope).toBe("change");
        expect(change.scopeTarget).toMatchObject({ kind: "change", value: "current" });
        expect(change.recommendedCommands).toContain("forge timeline --session current --json");
      }

      const proof = await runAgentMemoryCommand({
        subcommand: "context",
        workspaceRoot: root,
        json: true,
        target: "generic",
        proof: "security-prove",
      });
      expect("agentMemory" in proof).toBe(true);
      if ("agentMemory" in proof) {
        expect(proof.scope).toBe("proof");
        expect(proof.scopeTarget).toMatchObject({
          kind: "proof",
          value: "security-prove",
          semanticTarget: "proof:security-prove",
        });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function mcpToolText(response: Record<string, unknown> | null): string {
  const result = response?.result;
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "";
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  const first = content[0];
  return first && typeof first === "object" && !Array.isArray(first) && typeof (first as { text?: unknown }).text === "string"
    ? (first as { text: string }).text
    : "";
}
