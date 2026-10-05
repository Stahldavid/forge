import { chmodSync, statSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
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
import { probeDeltaBroker, shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import { pidWasReused, processStartTimeMs } from "../../src/forge/delta/process-identity.ts";
import { createAmbientDeltaRecorder } from "../../src/forge/delta/recorder.ts";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${name}-`));
}

async function waitForOwnedFixtureBroker(root: string) {
  // Hooks dispatch the owner asynchronously. Do not delete its root while it
  // is still starting, before a verified endpoint can be observed.
  const deadline = Date.now() + 10_000;
  let owner = await probeDeltaBroker(root);
  while (!owner.active && Date.now() < deadline) {
    await new Promise(done => setTimeout(done, 200));
    owner = await probeDeltaBroker(root);
  }
  if (!owner.active) throw new Error(`Fixture broker did not become observable before cleanup: ${root}`);
  return owner;
}

async function stopOwnedFixtureBroker(root: string, waitForStartup = true): Promise<void> {
  const owner = waitForStartup ? await waitForOwnedFixtureBroker(root) : await probeDeltaBroker(root);
  if (!owner.active) return;
  const pid = owner.pid;
  const endpoint = pid ? JSON.parse(readFileSync(join(root, ".forge", "delta", "broker-endpoint.json"), "utf8")) as {
    pid: number; root: string; createdAt: string;
  } : undefined;
  if (endpoint && (endpoint.pid !== pid || endpoint.root !== root)) throw new Error("Fixture broker endpoint changed before cleanup");
  const started = pid ? processStartTimeMs(pid) : null;
  await shutdownDeltaBroker(root);
  if (!pid) return;
  const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const waitForExit = async () => {
    for (let attempt = 0; attempt < 20 && alive(); attempt += 1) {
      await new Promise(done => setTimeout(done, 100));
    }
    return !alive();
  };
  if (await waitForExit()) return;
  // Bun can retain a pending background drain after the authenticated stop has
  // closed PGlite. This fixture owns the verified process; never kill an unknown
  // identity, a reused PID, another fixture or the test runner itself.
  if (pid === process.pid || !endpoint || started === null || pidWasReused(pid, endpoint.createdAt) || processStartTimeMs(pid) !== started) {
    throw new Error(`Fixture broker identity changed before cleanup: ${root}`);
  }
  process.kill(pid, process.platform === "win32" ? "SIGTERM" : "SIGKILL");
  if (!(await waitForExit())) throw new Error(`Fixture broker did not exit: ${root}`);
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
      expect(smoke.exitCode).toBe(0);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_DELTA_BUSY")).toBe(false);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_AGENT_HOOK_CANARY_NOT_VISIBLE")).toBe(false);
      expect(smoke.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_AGENT_HOOK_CANARY_MISSING")).toBe(false);
      expect(smoke.checks.find((check) => check.name === "canary-visible")?.ok).toBe(true);
    } finally {
      if (store) {
        await store.close();
      }
      await stopOwnedFixtureBroker(root);
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

  test("Codex MCP hooks enqueue redacted events without command hooks", async () => {
    const root = tempWorkspace("h48-codex-mcp-hook");
    try {
      const installed = await runAgentMemoryCommand({
        subcommand: "install", workspaceRoot: root, json: true,
        target: "codex", mcpServer: "forge_fabric_local",
      });
      expect(installed.exitCode).toBe(0);
      const hooks = JSON.parse(readFileSync(join(root, ".codex", "hooks.json"), "utf8"));
      const preToolUse = hooks.hooks.PreToolUse[0].hooks[0];
      expect(preToolUse).toMatchObject({
        type: "mcp_tool", server: "forge_fabric_local", tool: "agent_hook_ingest",
      });
      expect(preToolUse.command).toBeUndefined();
      expect(preToolUse.input.payload).toMatchObject({
        turn_id: "${turn_id}", tool_use_id: "${tool_use_id}",
      });
      const postToolUse = hooks.hooks.PostToolUse[0].hooks[0];
      expect(postToolUse.input.payload.tool_response).toMatchObject({ status: "${tool_response.status}" });
      expect(JSON.stringify(postToolUse.input)).not.toContain('"tool_response":"${tool_response}"');
      await runAgentMemoryCommand({
        subcommand: "install", workspaceRoot: root, json: true, target: "codex", force: true,
      });
      const reinstalled = JSON.parse(readFileSync(join(root, ".codex", "hooks.json"), "utf8"));
      expect(reinstalled.hooks.PreToolUse[0].hooks[0].type).toBe("mcp_tool");

      // Keep this focused on the MCP ingress; no background broker is needed.
      rmSync(join(root, ".forge", "agent", "codex-hook.meta.json"));
      const response = await handleMcpRequest(root, {
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "agent_hook_ingest", arguments: {
          eventName: "PreToolUse",
          payload: { cwd: root, session_id: "codex-mcp-test", turn_id: "turn-1", tool_use_id: "tool-1", tool_name: "Bash", tool_input: { command: "echo TOPSECRET" } },
        } },
      });
      const resultText = (response?.result as { content: Array<{ text: string }> }).content[0]?.text;
      expect(JSON.parse(resultText ?? "null")).toEqual({ ok: true, queued: true });
      const queued = readFileSync(join(root, ".forge", "agent", "events.ndjson"), "utf8");
      expect(queued).toContain('"payloadRedacted":true');
      expect(queued).toContain('"commandHash":');
      expect(queued).toContain('"integration":"mcp"');
      expect(queued).toContain('"turn_id":"turn-1"');
      expect(queued).toContain('"tool_use_id":"tool-1"');
      expect(queued).not.toContain("TOPSECRET");
      const inspected = inspectAgentMemoryQueueFile({
        workspaceRoot: root, watchFile: join(root, ".forge", "agent", "events.ndjson"), source: "codex",
      });
      expect(inspected.nativeSignals).toBe(0);
      const largeCommand = `echo ${"X".repeat(300_000)}`;
      const largeResponse = await handleMcpRequest(root, {
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "agent_hook_ingest", arguments: {
          eventName: "PreToolUse",
          payload: { cwd: root, session_id: "codex-mcp-test", tool_name: "Bash", tool_input: { command: largeCommand } },
        } },
      });
      expect(JSON.stringify(largeResponse)).toContain("queued");
      const queueAfterLarge = readFileSync(join(root, ".forge", "agent", "events.ndjson"), "utf8");
      expect(queueAfterLarge).toContain(createHash("sha256").update(largeCommand).digest("hex"));
      expect(queueAfterLarge).not.toContain("XXXXXX");
      const rejected = await handleMcpRequest(root, {
        jsonrpc: "2.0", id: 2, method: "tools/call",
        params: { name: "agent_hook_ingest", arguments: {
          eventName: "PreToolUse", payload: { cwd: dirname(root), session_id: "wrong-workspace" },
        } },
      });
      expect(JSON.stringify(rejected)).toContain("outside the MCP server workspace");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

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
          future_codex_field: { privateText: `unrecognized payload ${secret}` },
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
      expect(payload.commandSummary).toBe("forge run");
      expect(payload.responseStored).toBe(false);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("do the publish");
      expect(serialized).not.toContain("unrecognized payload");
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

  test("replays a committed queue line after checkpoint rollback without duplicate memory", async () => {
    const root = tempWorkspace("h48-codex-hook-replay-rollback");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(queueFile, `${queuedCodexHookLine(root, "SessionStart", "replay-1")}\n`, "utf8");
      const first = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(first.eventsIngested).toBe(1);
      writeFileSync(`${queueFile}.checkpoint.json`, JSON.stringify({ offset: 0 }), "utf8");
      const replay = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(replay.errors).toEqual([]);
      const store = await DeltaStore.open(root, { access: "read" });
      try {
        expect(await store.listAgentMemoryEvents({ target: "codex" })).toHaveLength(1);
      } finally {
        await store.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("keeps distinct legacy occurrences even when queued lines are byte-identical", async () => {
    const root = tempWorkspace("h48-codex-hook-identical-lines");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const line = queuedCodexHookLine(root, "SessionStart", "same-session");
      writeFileSync(queueFile, `${line}\n${line}\n`, "utf8");
      const first = await drainAgentMemoryQueueFile({
        workspaceRoot: root, watchFile: queueFile, source: "codex", maxEvents: 1, compactAfterBytes: 1,
      });
      expect(first.eventsIngested).toBe(1);
      expect(first.compacted).toBe(true);
      const second = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(second.eventsIngested).toBe(1);
      writeFileSync(`${queueFile}.checkpoint.json`, JSON.stringify({ offset: 0 }), "utf8");
      await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      const store = await DeltaStore.open(root, { access: "read" });
      try { expect(await store.listAgentMemoryEvents({ target: "codex" })).toHaveLength(2); }
      finally { await store.close(); }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("recovers unconsumed tail after queue replacement before checkpoint reset", async () => {
    const root = tempWorkspace("h48-codex-hook-compaction-crash");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const lines = ["first", "second", "third"].map((name) => queuedCodexHookLine(root, "SessionStart", name));
      writeFileSync(queueFile, `${lines.join("\n")}\n`, "utf8");
      const first = await drainAgentMemoryQueueFile({
        workspaceRoot: root, watchFile: queueFile, source: "codex", maxEvents: 1,
      });
      expect(first.eventsIngested).toBe(1);
      const oldCheckpoint = JSON.parse(readFileSync(`${queueFile}.checkpoint.json`, "utf8")) as { offset: number };
      expect(oldCheckpoint.offset).toBeGreaterThan(0);
      // Simulate the exact crash state: atomic replacement landed, checkpoint
      // still points into the previous generation's consumed prefix.
      writeFileSync(queueFile, `${JSON.stringify({ forgeHookQueueGeneration: randomUUID() })}\n${lines.slice(1).join("\n")}\n`, "utf8");
      expect(readFileSync(queueFile).length).toBeGreaterThan(oldCheckpoint.offset);
      const recovered = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(recovered.errors).toEqual([]);
      expect(recovered.eventsIngested).toBe(2);
      const store = await DeltaStore.open(root, { access: "read" });
      try { expect(await store.listAgentMemoryEvents({ target: "codex" })).toHaveLength(3); }
      finally { await store.close(); }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("replays old queue safely if checkpoint survives but rename does not", async () => {
    const root = tempWorkspace("h48-codex-hook-compaction-rollback");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const original = `${queuedCodexHookLine(root, "SessionStart", "rollback-one")}\n${queuedCodexHookLine(root, "SessionStart", "rollback-two")}\n`;
      writeFileSync(queueFile, original, "utf8");
      const compacted = await drainAgentMemoryQueueFile({
        workspaceRoot: root, watchFile: queueFile, source: "codex", maxEvents: 1, compactAfterBytes: 1,
      });
      expect(compacted.compacted).toBe(true);
      const checkpoint = JSON.parse(readFileSync(`${queueFile}.checkpoint.json`, "utf8")) as { generation?: string };
      expect(checkpoint.generation).toBeDefined();
      // Power loss may preserve the newer checkpoint yet restore the old name.
      writeFileSync(queueFile, original, "utf8");
      const replay = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(replay.errors).toEqual([]);
      const store = await DeltaStore.open(root, { access: "read" });
      try { expect(await store.listAgentMemoryEvents({ target: "codex" })).toHaveLength(2); }
      finally { await store.close(); }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("migrates normalized fallback records without granting native hook trust", async () => {
    const root = tempWorkspace("h48-codex-hook-fallback-migration");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      const envelope = normalizeAgentEvent({
        workspaceRoot: root, source: "generic", integration: "manual-import", eventName: "SessionStart",
        raw: { session_id: "legacy-fallback", hook_event_name: "SessionStart" },
      });
      envelope.capture.trustLevel = "manual-import";
      const fallback = {
        id: "amem_legacy", externalEventId: "aevt_legacy", sourceName: "generic",
        integrationKind: "manual-import", trustLevel: "manual-import", eventKind: envelope.event.kind,
        normalizedKind: envelope.event.kind, confidence: envelope.capture.confidence,
        capturedAt: envelope.event.timestamp, data: { envelope, bindings: {} },
      };
      writeFileSync(queueFile, `${JSON.stringify(fallback)}\n${queuedCodexHookLine(root, "SessionStart", "native-after-legacy")}\n`, "utf8");
      const before = inspectAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(before.nativeSignals).toBe(1);
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(2);
      const store = await DeltaStore.open(root, { access: "read" });
      try {
        const events = await store.listAgentMemoryEvents({ limit: 10 });
        expect(events).toHaveLength(2);
        expect(events.find((event) => event.externalSessionId === "legacy-fallback")?.trustLevel).toBe("manual-import");
      } finally { await store.close(); }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("bounded memory read drains a batch and reports remaining queue work", async () => {
    const root = tempWorkspace("h48-codex-hook-bounded-read");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(queueFile, [
        ...Array.from({ length: 130 }, (_, index) => queuedCodexHookLine(root, "PostToolUse", `bounded-${index}`)),
        "",
      ].join("\n"), "utf8");
      const bounded = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex", maxEvents: 1 });
      expect(bounded.eventsIngested).toBe(1);
      expect(bounded.pendingBytes).toBeGreaterThan(0);
      const read = await runAgentMemoryCommand({ subcommand: "memory", workspaceRoot: root, json: true, entry: "codex", limit: 200 });
      expect(read.ok).toBe(true);
      if (read.ok && "freshness" in read && read.freshness) {
        expect(["pending", "current"]).toContain(read.freshness.status);
        if (read.freshness.status === "pending") expect(read.freshness.pendingBytes).toBeGreaterThan(0);
      }
      const after = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(after.errors).toEqual([]);
      const complete = await runAgentMemoryCommand({ subcommand: "context", workspaceRoot: root, json: true });
      expect(complete.ok).toBe(true);
      if (complete.ok && "agentMemory" in complete) {
        expect(complete.freshness?.status).toBe("current");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test("quarantines malformed line metadata and continues to a valid hook", async () => {
    const root = tempWorkspace("h48-codex-hook-reject");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(queueFile, [
        "{invalid sensitive_canary_123",
        queuedCodexHookLine(root, "SessionStart", "after-reject"),
        "",
      ].join("\n"), "utf8");
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(1);
      const rejection = readFileSync(`${queueFile}.rejects.ndjson`, "utf8");
      expect(rejection).toContain("invalid-json-object");
      expect(rejection).not.toContain("sensitive_canary_123");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("serializes concurrent queue drains before reading the checkpoint", async () => {
    const root = tempWorkspace("h48-codex-hook-concurrent-drain");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(queueFile, [
        queuedCodexHookLine(root, "SessionStart", "codex-concurrent-1"),
        queuedCodexHookLine(root, "PostToolUse", "codex-concurrent-1"),
        "",
      ].join("\n"), "utf8");

      const [first, second] = await Promise.all([
        drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex", compactAfterBytes: 1 }),
        drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex", compactAfterBytes: 1 }),
      ]);
      expect(first.errors).toEqual([]);
      expect(second.errors).toEqual([]);
      expect(first.busy).toBeUndefined();
      expect(second.busy).toBeUndefined();
      expect(first.eventsIngested + second.eventsIngested).toBe(2);
      const compactedQueue = readFileSync(queueFile, "utf8");
      expect(compactedQueue).toMatch(/^\{"forgeHookQueueGeneration":"[0-9a-f-]+"\}\n$/u);
      expect(first.pendingBytes + second.pendingBytes).toBe(0);

      const store = await DeltaStore.open(root, { access: "read" });
      try {
        expect(await store.listAgentMemoryEvents({ target: "codex" })).toHaveLength(2);
      } finally {
        await store.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 45_000);

  test("hook append waits for queue compaction lock", async () => {
    const root = tempWorkspace("h48-codex-hook-append-lock");
    const previousBackgroundDrain = process.env.FORGE_DELTA_BACKGROUND_DRAIN;
    process.env.FORGE_DELTA_BACKGROUND_DRAIN = "0";
    try {
      const installed = await runAgentMemoryCommand({ subcommand: "install", workspaceRoot: root, json: true, target: "codex" });
      expect(installed.exitCode).toBe(0);
      const agentDir = join(root, ".forge", "agent");
      const queueFile = join(agentDir, "events.ndjson");
      const lockFile = `${queueFile}.append-lock.json`;
      writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: "test-holder" }), "utf8");
      const oldLockTime = new Date(Date.now() - 60_000);
      utimesSync(lockFile, oldLockTime, oldLockTime);

      const child = spawn(process.execPath, [join(agentDir, "codex-hook.mjs"), "SessionStart"], {
        cwd: root,
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
        // This case owns the manual drain; keep the broker from consuming it first.
        env: { ...process.env, FORGE_DELTA_BACKGROUND_DRAIN: "0" },
      });
      const closePromise = new Promise<number | null>((resolveExit) => child.on("close", resolveExit));
      child.stdin.end(JSON.stringify({ session_id: "codex-append-lock", cwd: root }));
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      expect(existsSync(queueFile)).toBe(false);
      unlinkSync(lockFile);
      const exitCode = await closePromise;
      expect(exitCode, stderr).toBe(0);
      expect(readFileSync(queueFile, "utf8")).toContain("codex-append-lock");
      expect(existsSync(lockFile)).toBe(false);

      writeFileSync(lockFile, JSON.stringify({ pid: process.pid, token: "test-holder-2" }), "utf8");
      utimesSync(lockFile, oldLockTime, oldLockTime);
      const drain = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex", compactAfterBytes: 1 });
      expect(drain.eventsIngested).toBe(1);
      expect(drain.compacted).toBe(false);
      expect(readFileSync(queueFile, "utf8")).toContain("codex-append-lock");
    } finally {
      try {
        // This case intentionally disables asynchronous owner startup.
        const lockFile = join(root, ".forge", "agent", "events.ndjson.append-lock.json");
        if (existsSync(lockFile)) unlinkSync(lockFile);
        await stopOwnedFixtureBroker(root, false);
        rmSync(root, { recursive: true, force: true });
      } finally {
        if (previousBackgroundDrain === undefined) delete process.env.FORGE_DELTA_BACKGROUND_DRAIN;
        else process.env.FORGE_DELTA_BACKGROUND_DRAIN = previousBackgroundDrain;
      }
    }
  }, 45_000);

  test("hook alone starts local owner and reaches Agent Memory without a CLI read", async () => {
    const root = tempWorkspace("h48-codex-hook-autostart");
    try {
      const installed = await runAgentMemoryCommand({ subcommand: "install", workspaceRoot: root, json: true, target: "codex" });
      expect(installed.exitCode).toBe(0);
      // A PID can be reused while an old endpoint remains. The hook must
      // authenticate a live broker over IPC instead of trusting that PID.
      const deltaDir = join(root, ".forge", "delta");
      mkdirSync(deltaDir, { recursive: true });
      const endpointId = createHash("sha256").update(root).digest("hex").slice(0, 24);
      const staleEndpoint = join(deltaDir, "broker-endpoint.json");
      writeFileSync(staleEndpoint, JSON.stringify({
        version: 1, root, pid: process.pid, createdAt: "2020-01-01T00:00:00.000Z",
        pipe: process.platform === "win32" ? `\\\\.\\pipe\\forge-delta-${endpointId}`
          : join(tmpdir(), `forge-delta-${process.getuid?.() ?? "user"}-${endpointId}.sock`),
        token: "0".repeat(64),
      }), { mode: 0o600 });
      if (process.platform !== "win32") {
        chmodSync(staleEndpoint, 0o600);
        expect(statSync(staleEndpoint).mode & 0o777).toBe(0o600);
      }
      const runner = join(root, ".forge", "agent", "codex-hook.mjs");
      // Match the installed Codex command's Node runtime, including the owner
      // it launches, rather than inheriting Bun's test-runner executable.
      const result = spawnSync("node", [runner, "SessionStart"], {
        cwd: root, input: JSON.stringify({ session_id: "hook-autostart", cwd: root }),
        encoding: "utf8", windowsHide: true,
        env: { ...process.env, FORGE_DELTA_BACKGROUND_DRAIN: "1" },
      });
      expect(result.status, result.error?.message ?? result.stderr).toBe(0);
      const queueFile = join(root, ".forge", "agent", "events.ndjson");
      const checkpoint = `${queueFile}.checkpoint.json`;
      let consumed = false;
      for (let attempt = 0; attempt < 150; attempt += 1) {
        if (existsSync(checkpoint)) {
          const state = JSON.parse(readFileSync(checkpoint, "utf8")) as { offset?: number };
          if ((state.offset ?? 0) > 0) { consumed = true; break; }
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
      const owner = await probeDeltaBroker(root);
      expect(consumed, JSON.stringify({ owner, hookStderr: result.stderr, queueExists: existsSync(queueFile), checkpointExists: existsSync(checkpoint) })).toBe(true);
      const store = await DeltaStore.open(root, { access: "read" });
      try {
        const events = await store.listAgentMemoryEvents({ target: "codex" });
        expect(events.some((event) => event.externalSessionId === "hook-autostart")).toBe(true);
      } finally { await store.close(); }
    } finally {
      await stopOwnedFixtureBroker(root, false);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("new hook seals a crashed partial line before appending its event", async () => {
    const root = tempWorkspace("h48-codex-hook-partial-repair");
    try {
      await runAgentMemoryCommand({ subcommand: "install", workspaceRoot: root, json: true, target: "codex" });
      const queueFile = join(root, ".forge", "agent", "events.ndjson");
      writeFileSync(queueFile, "{broken sensitive_partial_123", "utf8");
      const runner = join(root, ".forge", "agent", "codex-hook.mjs");
      const result = spawnSync(process.execPath, [runner, "SessionStart"], {
        cwd: root, input: JSON.stringify({ session_id: "after-partial", cwd: root }),
        encoding: "utf8", windowsHide: true,
        env: { ...process.env, FORGE_DELTA_BACKGROUND_DRAIN: "0" },
      });
      expect(result.status).toBe(0);
      expect(readFileSync(queueFile, "utf8").split(/\r?\n/u).filter(Boolean)).toHaveLength(2);
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(1);
      expect(readFileSync(`${queueFile}.rejects.ndjson`, "utf8")).not.toContain("sensitive_partial_123");
    } finally {
      await stopOwnedFixtureBroker(root);
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("drains a burst of Codex hook events without exhausting database handles", async () => {
    const root = tempWorkspace("h48-codex-hook-queue-burst");
    try {
      const agentDir = join(root, ".forge", "agent");
      mkdirSync(agentDir, { recursive: true });
      const queueFile = join(agentDir, "events.ndjson");
      writeFileSync(
        queueFile,
        [...Array.from({ length: 64 }, (_, index) => queuedCodexHookLine(root, "PostToolUse", `burst-${index}`)), ""].join("\n"),
        "utf8",
      );

      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.eventsIngested).toBe(64);

      const store = await DeltaStore.open(root, { access: "read" });
      try {
        expect(await store.listAgentMemoryEvents({ target: "codex", limit: 100 })).toHaveLength(64);
      } finally {
        await store.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("queue drain shares the active Delta owner and advances the checkpoint", async () => {
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
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(drained.errors).toEqual([]);
      expect(drained.busy).toBeUndefined();
      expect(drained.eventsIngested).toBe(1);
      expect(existsSync(`${queueFile}.checkpoint.json`)).toBe(true);

      await store.close();
      store = null;
      const retried = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
      expect(retried.errors).toEqual([]);
      expect(retried.eventsIngested).toBe(0);

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

  test("queue drain proceeds while another Delta handle remains open", async () => {
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
      const drained = await drainAgentMemoryQueueFile({ workspaceRoot: root, watchFile: queueFile, source: "codex" });
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
  }, 30_000);

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
      const compactedQueue = readFileSync(queueFile, "utf8");
      expect(compactedQueue).toMatch(/^\{"forgeHookQueueGeneration":"[0-9a-f-]+"\}\n/u);
      expect(compactedQueue.endsWith(partialLine)).toBe(true);
      const history = readFileSync(drained.historyFile, "utf8");
      expect(history).toContain("codex-session-retention-1");
      expect(history).toContain("\"payloadRedacted\":true");
      expect(history).not.toContain(secret);
      expect(history).not.toContain("\"raw\":");
      expect(history).not.toContain("forge run billing.createInvoice --args");
      const checkpoint = JSON.parse(readFileSync(`${queueFile}.checkpoint.json`, "utf8")) as { offset: number; generation: string };
      expect(checkpoint.offset).toBe(Buffer.byteLength(compactedQueue) - Buffer.byteLength(partialLine));
      expect(checkpoint.generation).toBeDefined();

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
    expect(parseCli(["agent", "install", "codex", "--mcp-server", "forge_fabric_local", "--json"]).command).toMatchObject({
      kind: "agent",
      options: { subcommand: "install", target: "codex", mcpServer: "forge_fabric_local" },
    });
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
      await shutdownDeltaBroker(root).catch(() => undefined);
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
