import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readProgramRuntimeOptions } from "../../src/forge/agent-fabric/program-runtime-options.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";

test("owner configuration bounds and authoring CLI preserve trusted input boundaries", () => {
  const root = mkdtempSync(join(tmpdir(), "fabric-public-"));
  try {
    expect(readProgramRuntimeOptions(root)).toEqual({});
    mkdirSync(join(root, ".forge"));
    const path = join(root, ".forge/fabric-runtime.json");
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, ownerCapacity: 8, ownerMaxTokens: 10000 }));
    expect(readProgramRuntimeOptions(root)).toEqual({ ownerCapacity: 8, ownerMaxTokens: 10000 });
    for (const config of [{ schemaVersion: 1, ownerCapacity: 33 }, { schemaVersion: 1, ownerMaxTokens: -1 }, { schemaVersion: 1, registry: {} }]) {
      writeFileSync(path, JSON.stringify(config));
      expect(() => readProgramRuntimeOptions(root)).toThrow();
    }
    expect(parseCli(["fabric", "program-author-types", "--json"]).errors).toEqual([]);
    expect(parseCli(["fabric", "program-author-types", "--file", "request.json"]).errors.length).toBeGreaterThan(0);
    expect(parseCli(["fabric", "program-author", "--file", "request.json", "--json"]).errors).toEqual([]);
    expect(parseCli(["fabric", "program-author"]).errors.length).toBeGreaterThan(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("MCP author-types accepts its empty schema and routes only authenticated owner reads", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fabric-mcp-author-"))), token = "a".repeat(64);
  let requests = 0;
  const server = createServer((request, response) => {
    expect(request.url).toBe("/v1/program-author-types");
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    let body = ""; request.on("data", chunk => { body += chunk.toString(); });
    request.on("end", () => { expect(JSON.parse(body)).toEqual({}); requests++; response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ ok: true, status: { source: "export interface OwnerSchemas {}" } })); });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const directory = join(root, ".forge/local/agent-fabric"); mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "owner-endpoint.json"), JSON.stringify({ schemaVersion: 1, repositoryRoot: root, pid: process.pid, port: (server.address() as AddressInfo).port, token }));
    const response = await handleMcpRequest(root, { method: "tools/call", id: 1, params: { name: "fabric_program_author_types", arguments: {} } });
    expect(response?.error).toBeUndefined();
    expect(JSON.stringify(response)).toContain("OwnerSchemas"); expect(requests).toBe(1);
    const rejected = await handleMcpRequest(root, { method: "tools/call", id: 2, params: { name: "fabric_program_author_types", arguments: { runId: "unrelated" } } });
    expect(rejected?.error).toBeDefined(); expect(requests).toBe(1);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
