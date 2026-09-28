import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

test("MCP exposes proposals and status only through the local owner", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "forge-fabric-mcp-"));
  try {
    const listed = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 1, method: "tools/list",
    });
    const names = (listed?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toContain("fabric_capabilities");
    expect(names).toContain("fabric_propose");
    expect(names).toContain("fabric_status");
    expect(names).toContain("fabric_evidence");
    expect(names).toContain("fabric_change_propose");
    expect(names).toContain("fabric_change_status");
    expect(names).toContain("fabric_change_evidence");
    expect(names).not.toContain("fabric_change_review");
    expect(names).not.toContain("fabric_authorize");
    expect(names).not.toContain("fabric_start");

    const called = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "fabric_capabilities", arguments: {} },
    });
    const payload = JSON.parse((called?.result as { content: { text: string }[] }).content[0]?.text ?? "null");
    expect(payload).toMatchObject({
      ok: true, codingTaskControl: "local_owner_service_required", ownerApproval: "local_popup_cli_only",
      taskMutationTools: ["fabric_propose"],
      taskReadTools: ["fabric_status", "fabric_evidence"],
      changeMutationTools: ["fabric_change_propose"],
      changeReadTools: ["fabric_change_status", "fabric_change_evidence"],
      changeReviewDispatch: "owner_cli_only",
    });
    const invalid = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "fabric_capabilities", arguments: { authorize: true } },
    });
    expect(invalid?.error).toMatchObject({ code: -32000 });
    const rejectedReview = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "fabric_change_review", arguments: { changeId: "change:example" } },
    });
    expect(rejectedReview?.error).toMatchObject({ code: -32000 });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("CLI accepts explicit change review commands and requires a change id", () => {
  expect(parseCli(["fabric", "change-propose", "--file", "request.json", "--json"]).command)
    .toMatchObject({ kind: "fabric", subcommand: "change-propose", file: "request.json", json: true });
  expect(parseCli(["fabric", "change-propose"]).errors.length).toBeGreaterThan(0);
  for (const subcommand of ["change-status", "change-review", "change-evidence"]) {
    expect(parseCli(["fabric", subcommand, "--task-id", "change:example", "--json"]).command)
      .toMatchObject({ kind: "fabric", subcommand, taskId: "change:example", json: true });
    expect(parseCli(["fabric", subcommand, "--json"]).errors.length).toBeGreaterThan(0);
  }
});

test("MCP proposes a change and reads its evidence without starting a reviewer", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "forge-fabric-change-mcp-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: workspace, windowsHide: true });
  try {
    git("init", "-q");
    git("config", "user.name", "Fabric Test");
    git("config", "user.email", "fabric@example.test");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(workspace, "answer.txt"), "alpha\n");
    git("add", "answer.txt");
    git("commit", "-qm", "baseline");
    writeFileSync(join(workspace, "answer.txt"), "beta\n");
    const proposed = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "fabric_change_propose", arguments: {
        request: { objective: "Change answer to beta", acceptanceCriteria: ["answer.txt contains beta"],
          implementer: "codex-app" },
      } },
    });
    expect(proposed?.error).toBeUndefined();
    const proposal = JSON.parse((proposed?.result as { content: { text: string }[] }).content[0]?.text ?? "null");
    expect(proposal.status).toMatchObject({ state: "proposed", latestRound: 0, canAccept: false });
    const changeId = proposal.status.changeId as string;
    const queried = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "fabric_change_status", arguments: { changeId } },
    });
    expect(queried?.error).toBeUndefined();
    const status = JSON.parse((queried?.result as { content: { text: string }[] }).content[0]?.text ?? "null");
    expect(status.status.changeId).toBe(changeId);
    const evidenceResult = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "fabric_change_evidence", arguments: { changeId } },
    });
    const evidence = JSON.parse((evidenceResult?.result as { content: { text: string }[] }).content[0]?.text ?? "null");
    expect(evidence.evidence.status.changeId).toBe(changeId);
    expect(evidence.evidence.rounds).toEqual([]);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
