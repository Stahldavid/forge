import { describe, expect, test } from "bun:test";
import type { CodexOptions, ThreadOptions, TurnOptions, ThreadEvent } from "@openai/codex-sdk";
import { runCodexWorker, runTypedCodexWorker, codexWorkerEnvironment, codexWorkerMcpIsolation, type CodexWorkerFactory, type CodexWorkerEvent } from "../../src/forge/agent-fabric/codex-sdk-worker.ts";

const report = { summary: "Implemented and verified fixture", verdict: null, findings: [], selectedNodeIds: [], replanProposal: null };
const usage = { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, cache_write_input_tokens: 0, reasoning_output_tokens: 0 };
function message(body: unknown): ThreadEvent { return { type: "item.completed", item: { id: "answer", type: "agent_message", text: typeof body === "string" ? body : JSON.stringify(body) } }; }
function fixture(events: ThreadEvent[], inspect?: (options: CodexOptions, threadOptions: ThreadOptions, turnOptions: TurnOptions, resumeId?: string) => void): CodexWorkerFactory {
  return (options) => {
    const thread = (threadOptions: ThreadOptions, resumeId?: string) => ({ id: resumeId ?? null, async runStreamed(_prompt: string, turnOptions: TurnOptions) {
      inspect?.(options, threadOptions, turnOptions, resumeId);
      return { events: (async function* () { for (const event of events) yield event; })() };
    } });
    return { startThread: (options) => thread(options), resumeThread: (id, options) => thread(options, id) };
  };
}
const success: ThreadEvent[] = [{ type: "thread.started", thread_id: "thread-fixture" }, { type: "turn.started" }, message(report), { type: "turn.completed", usage }];
function input(role: "implementer" | "reviewer" | "investigator" | "decision" = "implementer") { return { cwd: process.cwd(), prompt: "Execute a bounded fixture task", role, signal: new AbortController().signal, onEvent: (_event: CodexWorkerEvent) => {} }; }

describe("managed Codex SDK worker", () => {
  test("v2 separates typed data from the completion envelope and preserves sandbox/schema", async () => {
    const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
    const output = await runTypedCodexWorker({ ...input("investigator"), outputSchema: schema, validateOutput: data => { expect(data).toEqual({ answer: "typed" }); } }, fixture([success[0]!, message({ answer: "typed" }), success[3]!], (_options, thread, turn) => { expect(thread.sandboxMode).toBe("read-only"); expect(turn.outputSchema).toEqual(schema); }));
    expect(output.data).toEqual({ answer: "typed" }); expect(output.threadId).toBe("thread-fixture"); expect(output.usage?.input_tokens).toBe(10);
  });
  test("v2 rejects invalid data, missing completion, late errors and callback failures", async () => {
    const typed = { ...input(), outputSchema: { type: "object" }, validateOutput: (_data: unknown) => {} };
    await expect(runTypedCodexWorker(typed, fixture([success[0]!, message("not json"), success[3]!]))).rejects.toMatchObject({ code: "AF_CODEX_REPORT" });
    await expect(runTypedCodexWorker(typed, fixture([success[0]!, message({ answer: "typed" })]))).rejects.toMatchObject({ code: "AF_CODEX_INCOMPLETE" });
    await expect(runTypedCodexWorker(typed, fixture([success[0]!, message({}), success[3]!, { type: "error", message: "private" }]))).rejects.toMatchObject({ code: "AF_CODEX_TURN_FAILED" });
    await expect(runTypedCodexWorker({ ...typed, onEvent: () => { throw new Error("private-secret"); } }, fixture(success))).rejects.toMatchObject({ code: "AF_CODEX_EXECUTION", message: "Typed SDK or persistence failed; reconcile before retry" });
  });
  test("streams a real SDK-shaped turn with explicit sandbox, schema, minimal environment and redacted events", async () => {
    const events: CodexWorkerEvent[] = [];
    const withCommand: ThreadEvent[] = [success[0]!, { type: "item.completed", item: { id: "cmd", type: "command_execution", command: "echo SECRET_TOKEN", aggregated_output: "SECRET_OUTPUT", status: "completed", exit_code: 0 } }, ...success.slice(1)];
    const output = await runCodexWorker({ ...input(), model: "model-fixture", onEvent: (event) => { events.push(event); } }, fixture(withCommand, (options, threadOptions, turnOptions) => {
      expect(options.config?.mcp_servers).toEqual({}); expect(options.config?.shell_environment_policy).toEqual({ inherit: "none", set: {} });
      expect(options.env).toBeDefined(); expect(options.env?.OPENAI_API_KEY).toBeUndefined();
      expect(threadOptions).toMatchObject({ model: "model-fixture", sandboxMode: "workspace-write", networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never" });
      expect(turnOptions.outputSchema).toMatchObject({ type: "object", additionalProperties: false }); expect(turnOptions.signal).toBeDefined();
    }));
    expect(output).toMatchObject({ threadId: "thread-fixture", report: { summary: report.summary }, usage: { input_tokens: 10, cached_input_tokens: 2, output_tokens: 5 }, eventsObserved: 5 });
    expect(JSON.stringify(events)).not.toContain("SECRET_TOKEN"); expect(JSON.stringify(events)).not.toContain("SECRET_OUTPUT");
  });
  test("awaits durable thread callback before consuming further events", async () => {
    let persisted = false;
    const factory: CodexWorkerFactory = () => ({ startThread: () => ({ id: null, runStreamed: async () => ({ events: (async function* () { yield success[0]!; expect(persisted).toBe(true); for (const event of success.slice(1)) yield event; })() }) }), resumeThread: () => { throw new Error("Unexpected resume"); } });
    await runCodexWorker({ ...input(), onEvent: async (event) => { if (event.type === "thread.started") { await new Promise((resolve) => setTimeout(resolve, 5)); persisted = true; } } }, factory);
  });
  test("resumes reviewer in read-only mode and requires an explicit verdict", async () => {
    const output = await runCodexWorker({ ...input("reviewer"), threadId: "thread-fixture" }, fixture([message({ ...report, verdict: "approved" }), { type: "turn.completed", usage }], (_options, threadOptions, _turnOptions, resumeId) => { expect(resumeId).toBe("thread-fixture"); expect(threadOptions.sandboxMode).toBe("read-only"); }));
    expect(output.report.verdict).toBe("approved");
    await expect(runCodexWorker(input("reviewer"), fixture(success))).rejects.toMatchObject({ code: "AF_CODEX_REPORT" });
  });
  test("never fabricates success from a report without completion or from a failed turn", async () => {
    await expect(runCodexWorker(input(), fixture(success.slice(0, -1)))).rejects.toMatchObject({ code: "AF_CODEX_INCOMPLETE" });
    const events: CodexWorkerEvent[] = [];
    await expect(runCodexWorker({ ...input(), onEvent: (event) => { events.push(event); } }, fixture([...success, { type: "turn.failed", error: { message: "private credentials SECRET" } }]))).rejects.toMatchObject({ code: "AF_CODEX_TURN_FAILED" });
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });
  test("abort after thread persistence leaves an explicit uncertain outcome", async () => {
    const controller = new AbortController();
    await expect(runCodexWorker({ ...input(), signal: controller.signal, onEvent: (event) => { if (event.type === "thread.started") controller.abort(); } }, fixture(success))).rejects.toMatchObject({ code: "AF_CODEX_ABORTED" });
  });
  test("malformed reports, unsafe branch IDs and approval with findings fail closed", async () => {
    for (const bad of ["not JSON", { ...report, selectedNodeIds: ["../../outside"] }, { ...report, verdict: "approved", findings: [{ description: "Blocking issue" }] }, { ...report, extra: "field" }]) {
      await expect(runCodexWorker(input(), fixture([success[0]!, message(bad), success[3]!]))).rejects.toMatchObject({ code: "AF_CODEX_REPORT" });
    }
  });
  test("allows configured auth paths and excludes inherited provider secrets", () => {
    expect(codexWorkerEnvironment({ PATH: "tools", CODEX_HOME: "auth-directory", USERPROFILE: "profile", OPENAI_API_KEY: "secret", DATABASE_URL: "secret", CUSTOM_TOKEN: "secret" })).toEqual({ PATH: "tools", CODEX_HOME: "auth-directory", USERPROFILE: "profile" });
  });
  test("callback failures and SDK errors cannot leak raw error text", async () => {
    await expect(runCodexWorker({ ...input(), onEvent: () => { throw new Error("SECRET"); } }, fixture(success))).rejects.toMatchObject({ code: "AF_CODEX_EXECUTION", message: "Codex SDK or event persistence failed; reconcile its thread before retrying" });
    await expect(runCodexWorker(input(), () => { throw new Error("SECRET"); })).rejects.toMatchObject({ code: "AF_CODEX_EXECUTION" });
  });
  test("a subprocess stream error after turn.completed still prevents success", async () => {
    const factory: CodexWorkerFactory = () => ({ startThread: () => ({ id: null, runStreamed: async () => ({ events: (async function* () { for (const event of success) yield event; throw new Error("subprocess failed SECRET"); })() }) }), resumeThread: () => { throw new Error("Unexpected resume"); } });
    await expect(runCodexWorker(input(), factory)).rejects.toMatchObject({ code: "AF_CODEX_EXECUTION" });
  });
  test("an already cancelled job does not create a Codex client", async () => {
    const controller = new AbortController(); controller.abort(); let called = false;
    await expect(runCodexWorker({ ...input(), signal: controller.signal }, () => { called = true; throw new Error("must not run"); })).rejects.toMatchObject({ code: "AF_CODEX_ABORTED" });
    expect(called).toBe(false);
  });
  test("enumerates and explicitly disables merged MCP servers, verifies effective configuration", async () => {
    const calls: string[][] = [];
    const overrides = await codexWorkerMcpIsolation(async (arguments_) => { calls.push(arguments_); return [{ name: "inherited_server", enabled: arguments_.length === 0 }]; });
    expect(overrides).toEqual(["mcp_servers.inherited_server.enabled=false", `mcp_servers.inherited_server.command=${JSON.stringify(process.execPath)}`, "mcp_servers.inherited_server.args=[]"]);
    expect(calls).toEqual([[], overrides]);
    await expect(codexWorkerMcpIsolation(async () => [{ name: "new_server", enabled: true }])).rejects.toMatchObject({ code: "AF_CODEX_ISOLATION" });
  });
});
