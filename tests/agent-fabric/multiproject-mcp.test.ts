import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { serveLocalTasks } from "../../src/forge/agent-fabric/local-task-server.ts";
import { LocalTaskService } from "../../src/forge/agent-fabric/local-task-service.ts";

function fixture(parent: string, name: string): string {
  const root = join(parent, name); mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true });
  git("init", "-q"); git("config", "user.name", "Forge Test"); git("config", "user.email", "test@example.invalid");
  writeFileSync(join(root, "source.txt"), "alpha\n"); git("add", "source.txt"); git("commit", "-qm", "fixture");
  return root;
}

function payload(result: Record<string, unknown> | null): {
  project: { id: string; root: string }; projects: { id: string; root: string }[];
  projectContext: { id: string; root: string };
  projectRouting: { defaultWorkspace: string }; status: { taskId: string };
} {
  expect(result?.error).toBeUndefined();
  return JSON.parse((result!.result as { content: { text: string }[] }).content[0]!.text);
}

test("MCP routes registered projects to their own owner and preserves the default workspace", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-multiproject-mcp-"));
  const a = fixture(parent, "a"), b = fixture(parent, "b");
  const options = { registryDirectory: join(parent, "registry") };
  const call = (name: string, args: Record<string, unknown> = {}) => handleMcpRequest(a,
    { method: "tools/call", id: 1, params: { name, arguments: args } }, options);
  try {
    expect((await call("fabric_project_register", { root: "." }))!.error).toBeDefined();
    mkdirSync(join(b, "nested"));
    const registration = payload(await call("fabric_project_register", { root: join(b, "nested"), id: "project-b" }));
    expect(registration.project.root).toBe(realpathSync(b));
    expect(payload(await call("fabric_project_list")).projects).toContainEqual({ id: "project-b", root: realpathSync(b) });
    const list = await handleMcpRequest(a, { method: "tools/list", id: 1 }, options);
    const tools = (list!.result as { tools: { name: string; inputSchema: { properties: Record<string, unknown> } }[] }).tools;
    for (const name of ["fabric_run_start", "fabric_run_status", "fabric_attached_status", "fabric_project_doctor", "fabric_owner_start"]) {
      expect(tools.find(tool => tool.name === name)!.inputSchema.properties.projectId).toBeDefined();
    }
    expect(tools.find(tool => tool.name === "agent_hook_ingest")!.inputSchema.properties.projectId).toBeUndefined();
    expect(payload(await call("fabric_capabilities", { projectId: "project-b" })).projectRouting.defaultWorkspace).toBe(realpathSync(b));
    expect(payload(await call("fabric_capabilities")).projectRouting.defaultWorkspace).toBe(realpathSync(a));
    const service = await LocalTaskService.open(b, async () => "approved");
    try {
      const owner = await serveLocalTasks(b, service);
      try {
        const proposed = payload(await call("fabric_attached_propose", { projectId: "project-b", request: {
          requestId: "routed-request", goal: "Update source", scope: ["source.txt"],
          criteria: [{ criterionId: "c1", description: "source updated" }], requiredChecks: ["unit"],
        } }));
        const taskId = proposed.status.taskId;
        expect(proposed.projectContext).toEqual({ id: "project-b", root: realpathSync(b) });
        expect(payload(await call("fabric_attached_status", { projectId: "project-b", taskId })).status.taskId).toBe(taskId);
        const wrongRoot = await call("fabric_attached_status", { taskId });
        expect(wrongRoot!.error).toMatchObject({ message: expect.stringContaining("owner is not running") });
        const managed = await call("fabric_run_status", { projectId: "project-b", runId: "missing" });
        expect(managed!.error).toBeDefined();
        expect((managed!.error as { message: string }).message).not.toContain("requires only");
      } finally { await owner.close(); }
    } finally { await service.close(); }
    for (const args of [{ projectId: "unknown" }, { projectId: "" }, { projectId: 42 }, { root: b }]) {
      expect((await call("fabric_capabilities", args))!.error).toBeDefined();
    }
    const unexpectedRoot = await call("fabric_run_status", { projectId: "project-b", runId: "missing", root: a });
    expect(unexpectedRoot!.error).toMatchObject({ message: expect.stringContaining("requires only") });
    const hookEscape = await call("agent_hook_ingest", { eventName: "SessionStart", payload: { cwd: b } });
    expect(hookEscape!.error).toMatchObject({ message: expect.stringContaining("outside the MCP server workspace") });
  } finally { rmSync(parent, { recursive: true, force: true }); }
}, 60_000);
