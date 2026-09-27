import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { LocalTaskService } from "../../src/forge/agent-fabric/local-task-service.ts";
import { requestLocalTask, serveLocalTasks } from "../../src/forge/agent-fabric/local-task-server.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

test("CLI and MCP clients share one local owner without MCP approval tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-fabric-owner-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "user.name", "Forge Test");
    git(root, "config", "user.email", "forge-test@example.invalid");
    writeFileSync(join(root, "source.txt"), "alpha\n");
    git(root, "add", "source.txt");
    git(root, "commit", "-qm", "fixture");
    const service = await LocalTaskService.open(root, async () => "approved");
    try {
      const owner = await serveLocalTasks(root, service);
      try {
        const proposal = {
          schemaVersion: 1, repositoryId: "repo:fixture", baseCommit: git(root, "rev-parse", "HEAD"),
          goal: "Change source.txt", acceptanceCriteria: ["source.txt changes"], nonObjectives: [],
          sourcePaths: ["source.txt"], writablePaths: ["source.txt"],
          requestedModelTargetId: "target:ollama:local",
          limits: { maximumAttempts: 1, maximumWallClockMs: 60_000, maximumOutputTokens: 256,
            maximumContextBytes: 4_096, maximumPatchBytes: 4_096, expiresAt: Date.now() + 120_000 },
        };
        const list = await handleMcpRequest(root, { method: "tools/list", id: 1 });
        const names = ((list?.result as { tools: { name: string }[] }).tools).map((tool) => tool.name);
        expect(names).toContain("fabric_propose");
        expect(names).toContain("fabric_status");
        expect(names).not.toContain("fabric_approve");

        const submitted = await handleMcpRequest(root, {
          method: "tools/call", id: 2, params: { name: "fabric_propose", arguments: { proposal } },
        });
        const mcpStatus = JSON.parse((submitted?.result as { content: { text: string }[] }).content[0]!.text);
        expect(mcpStatus.status.state).toBe("proposed");
        const status = await requestLocalTask(root, "status", { taskId: mcpStatus.status.taskId });
        expect(status?.taskId).toBe(mcpStatus.status.taskId);
        const mcpRead = await handleMcpRequest(root, {
          method: "tools/call", id: 3,
          params: { name: "fabric_status", arguments: { taskId: mcpStatus.status.taskId } },
        });
        const mcpReadStatus = JSON.parse((mcpRead?.result as { content: { text: string }[] }).content[0]!.text);
        expect(mcpReadStatus.status.taskId).toBe(mcpStatus.status.taskId);

        const forbidden = await fetch(`http://127.0.0.1:${owner.port}/v1/status`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: mcpStatus.status.taskId }),
        });
        expect(forbidden.status).toBe(403);

        const reviewed = await requestLocalTask(root, "review", { taskId: mcpStatus.status.taskId });
        expect(reviewed?.state).toBe("owner_approved");
      } finally {
        await owner.close();
      }
      expect(await requestLocalTask(root, "status", { taskId: "task:" + "a".repeat(64) })).toBeNull();
    } finally {
      await service.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
