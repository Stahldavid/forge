import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";

test("MCP exposes an honest read-only Agent Fabric boundary", async () => {
  const workspace = mkdtempSync(join(tmpdir(), "forge-fabric-mcp-"));
  try {
    const listed = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 1, method: "tools/list",
    });
    const names = (listed?.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
    expect(names).toContain("fabric_capabilities");
    expect(names).not.toContain("fabric_authorize");
    expect(names).not.toContain("fabric_start");

    const called = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "fabric_capabilities", arguments: {} },
    });
    const payload = JSON.parse((called?.result as { content: { text: string }[] }).content[0]?.text ?? "null");
    expect(payload).toMatchObject({
      ok: true, codingTaskControl: "local_cli_available", ownerApproval: "local_popup_available",
      taskMutationTools: false,
    });
    const invalid = await handleMcpRequest(workspace, {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "fabric_capabilities", arguments: { authorize: true } },
    });
    expect(invalid?.error).toMatchObject({ code: -32000 });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
