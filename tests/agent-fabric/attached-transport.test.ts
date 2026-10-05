import { expect, test } from "bun:test";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { ATTACHED_TASK_ACTIONS, isAttachedTaskRead, requestAttachedTask, serveLocalTasks } from "../../src/forge/agent-fabric/local-task-server.ts";
import { LocalTaskService } from "../../src/forge/agent-fabric/local-task-service.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-attached-transport-"));
  git(root, "init", "-q"); git(root, "config", "user.name", "Forge Test");
  git(root, "config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "source.txt"), "alpha\n");
  git(root, "add", "source.txt"); git(root, "commit", "-qm", "fixture");
  return root;
}

test("attached and workflow CLI commands require complete file envelopes or explicit read ids", () => {
  for (const action of ATTACHED_TASK_ACTIONS) {
    const read = isAttachedTaskRead(action);
    expect(parseCli(["fabric", action]).command).toBeNull();
    expect(parseCli(["fabric", action, ...(read ? ["--task-id", "task:fixture"] : ["--file", "request.json"]), "--json"]).command)
      .toMatchObject({ kind: "fabric", subcommand: action, json: true, ...(read ? { taskId: "task:fixture" } : { file: "request.json" }) });
    expect(parseCli(["fabric", action, ...(read ? ["--task-id", "task:fixture", "--file", "request.json"] : ["--file", "request.json", "--task-id", "task:fixture"])]).command).toBeNull();
  }
});

test("MCP discovers accompanied actions with strict envelopes and honest capabilities", async () => {
  const root = fixture();
  try {
    const list = await handleMcpRequest(root, { method: "tools/list", id: 1 });
    const tools = (list!.result as { tools: { name: string; inputSchema: { required: string[]; additionalProperties: boolean } }[] }).tools;
    for (const action of ATTACHED_TASK_ACTIONS) {
      const tool = tools.find((item) => item.name === `fabric_${action.replaceAll("-", "_")}`)!;
      expect(tool.inputSchema.required).toEqual([isAttachedTaskRead(action) ? "taskId" : "request"]);
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
    const invalid = await handleMcpRequest(root, { method: "tools/call", id: 2,
      params: { name: "fabric_attached_attach", arguments: { request: {}, approve: true } } });
    expect(invalid!.error).toBeDefined();
    const capabilities = await handleMcpRequest(root, { method: "tools/call", id: 3,
      params: { name: "fabric_capabilities", arguments: {} } });
    const result = JSON.parse((capabilities!.result as { content: { text: string }[] }).content[0]!.text);
    expect(result.accompaniedTasks).toMatchObject({ runningOwnerRequired: true, automaticDispatch: false,
      managedWorkers: false, evidenceProvenance: "agent_reported" });
    await expect(requestAttachedTask(root, "attached-status", { taskId: "missing" })).rejects.toThrow("owner is not running");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test("owner routes attached requests with authentication and service validation", async () => {
  const root = fixture();
  try {
    const legacy = await LocalTaskService.open(root, async () => "approved");
    try {
      const owner = await serveLocalTasks(root, legacy);
      try {
        const unauthorized = await fetch(`http://127.0.0.1:${owner.port}/v1/attached-status`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: "missing" }),
        });
        expect(unauthorized.status).toBe(403);
        const proposal = { requestId: "transport-proposal", goal: "Update source", criteria: [{ criterionId: "c1", description: "source updated" }],
          scope: ["source.txt"], requiredChecks: ["unit"] };
        const created = await requestAttachedTask(root, "attached-propose", proposal) as { taskId: string; version: number };
        expect(created.version).toBe(1);
        // Exercise main's option validation and the actual CLI, beyond parseCli unit tests.
        for (const action of ["attached-status", "attached-context"]) {
          const { stdout } = await promisify(execFile)(process.execPath,
            [resolve("bin/forge.mjs"), "fabric", action, "--task-id", created.taskId, "--json"],
            { cwd: root, windowsHide: true, timeout: 20_000 });
          expect(JSON.parse(stdout)).toMatchObject({ ok: true, status: { taskId: created.taskId, version: 1 } });
        }
        expect(await requestAttachedTask(root, "attached-propose", proposal)).toEqual(created);
        const read = await handleMcpRequest(root, { method: "tools/call", id: 3,
          params: { name: "fabric_attached_status", arguments: { taskId: created.taskId } } });
        const status = JSON.parse((read!.result as { content: { text: string }[] }).content[0]!.text).status;
        expect(status).toMatchObject({ taskId: created.taskId, version: 1, readiness: { ready: false, provenance: "agent_reported" } });
        await expect(requestAttachedTask(root, "attached-status", { taskId: created.taskId, unexpected: true })).rejects.toThrow();
        const response = await handleMcpRequest(root, { method: "tools/call", id: 2,
          params: { name: "fabric_attached_status", arguments: { taskId: "missing" } } });
        expect(response!.error).toBeDefined();
      } finally { await owner.close(); }
      await expect(requestAttachedTask(root, "attached-status", { taskId: "missing" })).rejects.toThrow("owner is not running");
    } finally { await legacy.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
