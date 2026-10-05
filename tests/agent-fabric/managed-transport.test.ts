import { expect, test } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { MANAGED_RUN_ACTIONS, requestManagedRun, serveLocalTasks } from "../../src/forge/agent-fabric/local-task-server.ts";
import { LocalTaskService } from "../../src/forge/agent-fabric/local-task-service.ts";
import { hasUnknownOption, parseCli } from "../../src/forge/cli/parse.ts";

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-managed-transport-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q"); git("config", "user.name", "Forge Test"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "source.txt"), "fixture\n"); git("add", "source.txt"); git("commit", "-qm", "fixture");
  return root;
}

test("managed CLI distinguishes run identity and requires explicit request files", () => {
  for (const action of MANAGED_RUN_ACTIONS) {
    expect(parseCli(["fabric", action]).command).toBeNull();
    const args = ["fabric", action, ...(action === "run-status" ? ["--run-id", "run-fixture"] : ["--file", "request.json"]), "--json"];
    expect(hasUnknownOption(args)).toBeNull();
    expect(parseCli(args).command).toMatchObject({ kind: "fabric", subcommand: action,
      ...(action === "run-status" ? { runId: "run-fixture" } : { file: "request.json" }) });
    expect(parseCli(["fabric", action, "--task-id", "task-fixture", "--file", "request.json"]).command).toBeNull();
  }
  expect(parseCli(["fabric", "run-status", "--run-id", "run-fixture", "--file", "request.json"]).command).toBeNull();
});

test("MCP discovers explicit managed controls and declares that start dispatches processes", async () => {
  const root = fixture();
  try {
    const list = await handleMcpRequest(root, { method: "tools/list", id: 1 });
    const tools = (list!.result as { tools: { name: string; inputSchema: { required: string[]; additionalProperties: boolean; properties: Record<string, unknown> } }[] }).tools;
    for (const action of MANAGED_RUN_ACTIONS) {
      const tool = tools.find(item => item.name === `fabric_${action.replaceAll("-", "_")}`)!;
      expect(tool.inputSchema.required).toEqual([action === "run-status" ? "runId" : "request"]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    for (const name of ["fabric_run_start", "fabric_run_resume"]) {
      const schema = tools.find(item => item.name === name)!.inputSchema.properties.request as {
        properties: { environment: { additionalProperties: boolean; properties: { mode: { enum: string[] }; timeoutMs: { maximum: number } } } } };
      expect(schema.properties.environment.additionalProperties).toBe(false);
      expect(schema.properties.environment.properties.mode.enum).toEqual(["auto", "none"]);
      expect(schema.properties.environment.properties.timeoutMs.maximum).toBe(1800000);
    }
    const invalid = await handleMcpRequest(root, { method: "tools/call", id: 2,
      params: { name: "fabric_run_start", arguments: { request: {}, approve: true } } });
    expect(invalid!.error).toBeDefined();
    const capabilities = await handleMcpRequest(root, { method: "tools/call", id: 3,
      params: { name: "fabric_capabilities", arguments: {} } });
    const result = JSON.parse((capabilities!.result as { content: { text: string }[] }).content[0]!.text);
    expect(result.managedExecution).toMatchObject({ runningOwnerRequired: true, startDispatchesWork: true,
      boundedEventWaitMs: 30000, codexMayConsumeCredits: true,
      environment: { automaticPreparation: true, isolatedDependencies: true, cacheReuse: "verified_copy", ignoreScriptsDefault: true } });
    expect(result.consequentialEffects).toBe(true);
    expect(result.effectsByMode.managed).toBe("process_execution_and_optional_local_publication");
    expect(result.mcpDispatch).toMatchObject({ legacy: "proposal_only", managed: "run_start_dispatches_work" });
    expect(result.taskMutationTools).toContain("fabric_run_start");
    const cliCapabilities = JSON.parse(execFileSync(process.execPath, [resolve("bin/forge.mjs"), "fabric", "capabilities", "--json"],
      { cwd: root, encoding: "utf8", windowsHide: true }));
    expect(cliCapabilities.consequentialEffects).toBe(true);
    expect(cliCapabilities.mcpDispatch.managed).toBe("run_start_dispatches_work");
    await expect(requestManagedRun(root, "run-status", { runId: "missing" })).rejects.toThrow("owner is not running");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);

interface RunView { runId: string; version: number; status: string; cursor: number; provenance: string;
  steps: { status: string; nodeId: string; artifact?: { digest: string; changedFiles: string[] } }[] }
interface RunWait { run: RunView; cursor: number; events: { cursor: number; type: string }[]; cursorExpired: boolean }

test("authenticated owner runs a real command and shares managed state across CLI and MCP", async () => {
  const root = fixture();
  let owner: Awaited<ReturnType<typeof serveLocalTasks>> | undefined;
  const legacy = await LocalTaskService.open(root, async () => "approved");
  try {
    owner = await serveLocalTasks(root, legacy);
    const unauthorized = await fetch(`http://127.0.0.1:${owner.port}/v1/run-start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(unauthorized.status).toBe(403);
    const spec = { requestId: "managed-transport-command", goal: "Observe a real bounded command",
      scope: ["source.txt"], publish: false,
      workflow: { workflowId: "command-check", nodes: [{ nodeId: "check", kind: "verification",
        dependsOn: [], inputDigest: `sha256:${"a".repeat(64)}`, required: true }] },
      executors: [{ nodeId: "check", type: "command", argv: [process.execPath, "-e", 'process.stdout.write("observed-command")'], timeoutMs: 5000 }] };
    writeFileSync(join(root, "start.json"), JSON.stringify(spec));
    const { stdout } = await promisify(execFile)(process.execPath,
      [resolve("bin/forge.mjs"), "fabric", "run-start", "--file", "start.json", "--json"],
      { cwd: root, windowsHide: true, timeout: 20000 });
    const created = JSON.parse(stdout).status as RunView;
    expect(created.runId).toBeDefined();
    const replay = await requestManagedRun(root, "run-start", spec) as RunView;
    expect(replay.runId).toBe(created.runId);
    let view = await requestManagedRun(root, "run-status", { runId: created.runId }) as RunView;
    const deadline = Date.now() + 20000;
    while (!["completed", "failed", "blocked", "canceled"].includes(view.status) && Date.now() < deadline) {
      const next = await requestManagedRun(root, "run-wait", { runId: created.runId, cursor: view.cursor, waitMs: 500 }) as RunWait;
      view = next.run;
    }
    expect({ status: view.status, detail: view }).toMatchObject({ status: "completed" });
    expect(view.provenance).toBe("executor_observed");
    expect(view.steps).toMatchObject([{ nodeId: "check", status: "succeeded" }]);
    expect(readFileSync(join(root, "source.txt"), "utf8")).toBe("fixture\n");
    const cliStatus = await promisify(execFile)(process.execPath,
      [resolve("bin/forge.mjs"), "fabric", "run-status", "--run-id", created.runId, "--json"],
      { cwd: root, windowsHide: true, timeout: 20000 });
    expect(JSON.parse(cliStatus.stdout)).toMatchObject({ ok: true, status: { runId: created.runId, status: "completed" } });
    const mcp = await handleMcpRequest(root, { method: "tools/call", id: 4,
      params: { name: "fabric_run_status", arguments: { runId: created.runId } } });
    const mcpStatus = JSON.parse((mcp!.result as { content: { text: string }[] }).content[0]!.text).status;
    expect(mcpStatus).toMatchObject({ runId: created.runId, status: "completed" });
    expect(JSON.stringify(mcpStatus)).not.toContain("contentBase64");
    const events = await requestManagedRun(root, "run-wait", { runId: created.runId, cursor: 0, waitMs: 0 }) as RunWait;
    expect(events.events.length).toBeGreaterThan(0);
    expect(events.cursor).toBeGreaterThan(0);
    writeFileSync(join(root, "wait.json"), JSON.stringify({ runId: created.runId, cursor: 0, waitMs: 0 }));
    const cliWait = await promisify(execFile)(process.execPath,
      [resolve("bin/forge.mjs"), "fabric", "run-wait", "--file", "wait.json", "--json"],
      { cwd: root, windowsHide: true, timeout: 20000 });
    expect(JSON.parse(cliWait.stdout)).toMatchObject({ ok: true, status: { run: { runId: created.runId, status: "completed" } } });
    await expect(requestManagedRun(root, "run-wait", { runId: created.runId, waitMs: 30001 })).rejects.toThrow();
    await expect(requestManagedRun(root, "run-status", { runId: created.runId, unknown: true })).rejects.toThrow();
    await owner.close(); owner = undefined;
    await expect(requestManagedRun(root, "run-status", { runId: created.runId })).rejects.toThrow("owner is not running");
  } finally { await owner?.close(); await legacy.close(); rmSync(root, { recursive: true, force: true }); }
}, 60000);
