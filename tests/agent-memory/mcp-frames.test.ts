import { expect, test } from "bun:test";
import { spawn } from "node:child_process";

test("MCP stdio accepts split frames and UTF-8 byte lengths", async () => {
  const child = spawn("node", ["bin/forge.mjs", "mcp", "serve"], {
    cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { errors += chunk; });
  const frame = (value: object): Buffer => {
    const body = Buffer.from(JSON.stringify(value), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
  };
  const first = frame({ jsonrpc: "2.0", id: "é", method: "initialize", params: {} });
  const second = frame({ jsonrpc: "2.0", id: 2, method: "initialize", params: {} });
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  try {
    child.stdin.write(first.subarray(0, first.length - 3));
    await new Promise((resolve) => setTimeout(resolve, 50));
    child.stdin.end(Buffer.concat([first.subarray(first.length - 3), second]));
    const code = await Promise.race([
      completed,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("MCP process timed out")), 15_000)),
    ]);
    expect(code).toBe(0);
    expect(errors).toBe("");
    expect(output).toContain('"id":"é"');
    expect(output).toContain('"id":2');
  } finally { if (child.exitCode === null) child.kill(); }
}, 20_000);
