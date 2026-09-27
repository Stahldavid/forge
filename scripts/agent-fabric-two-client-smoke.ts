/** Opt-in local interoperability proof: two independent MCP stdio clients, one task owner. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const forgeBin = fileURLToPath(new URL("../bin/forge.mjs", import.meta.url));

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function frame(request: object): string {
  const body = JSON.stringify(request);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
}

function parseFrame(output: Buffer): Record<string, unknown> {
  const marker = Buffer.from("\r\n\r\n");
  const headerEnd = output.indexOf(marker);
  if (headerEnd < 0) throw new Error("MCP client received no response frame");
  const header = output.subarray(0, headerEnd).toString("ascii");
  const length = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1]);
  const body = output.subarray(headerEnd + marker.length);
  if (!Number.isSafeInteger(length) || body.length !== length) {
    throw new Error("MCP response frame length is invalid");
  }
  return JSON.parse(body.toString("utf8")) as Record<string, unknown>;
}

async function mcpCall(root: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const child = spawn(process.execPath, [forgeBin, "mcp", "serve"], {
    cwd: root, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timeout = setTimeout(() => child.kill(), 20_000);
  try {
    child.stdin.end(frame({ jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name, arguments: args } }));
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (code !== 0) throw new Error(`MCP client failed (${code}): ${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`);
    const response = parseFrame(Buffer.concat(stdout));
    if (response.error) throw new Error(`MCP ${name} error: ${JSON.stringify(response.error)}`);
    const result = response.result as { content?: { text?: string }[] };
    const payload = JSON.parse(result.content?.[0]?.text ?? "null") as Record<string, unknown>;
    if (payload.ok !== true) throw new Error(`MCP ${name} did not return success`);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function startOwner(root: string): Promise<() => Promise<void>> {
  const child = spawn(process.execPath, [forgeBin, "fabric", "serve", "--json"], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let pending = "";
  let errors = "";
  child.stderr.on("data", (chunk: Buffer) => { errors += chunk.toString("utf8"); });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => reject(new Error(`Local owner exited before ready (${code}): ${errors.slice(0, 500)}`)));
      child.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8");
        const newline = pending.indexOf("\n");
        if (newline < 0) return;
        const line = pending.slice(0, newline).trim();
        try {
          const result = JSON.parse(line) as { ok?: boolean; port?: number };
          if (result.ok === true && Number.isSafeInteger(result.port)) resolve();
          else reject(new Error(`Local owner did not report readiness: ${line}`));
        } catch (error) { reject(error); }
      });
    });
  } finally {
    clearTimeout(timer);
  }
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    child.kill();
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null) { resolve(); return; }
      child.once("close", () => resolve());
    });
  };
}

const root = mkdtempSync(join(tmpdir(), "forge-fabric-two-client-"));
try {
  git(root, "init", "-q");
  git(root, "config", "user.name", "Forge Smoke");
  git(root, "config", "user.email", "forge-smoke@example.invalid");
  writeFileSync(join(root, "answer.txt"), "alpha\n");
  git(root, "add", "answer.txt");
  git(root, "commit", "-qm", "fixture");
  const baseCommit = git(root, "rev-parse", "HEAD");
  const stopFirstOwner = await startOwner(root);
  try {
      const proposal = {
        schemaVersion: 1, repositoryId: "repo:two-client-fixture", baseCommit,
        goal: "Change the fixture", acceptanceCriteria: ["answer.txt changes"], nonObjectives: [],
        sourcePaths: ["answer.txt"], writablePaths: ["answer.txt"],
        requestedModelTargetId: "target:ollama:local", requestedModelId: "qwen2.5-coder:3b",
        limits: { maximumAttempts: 1, maximumWallClockMs: 60_000,
          maximumOutputTokens: 256, maximumContextBytes: 4_096,
          maximumPatchBytes: 4_096, expiresAt: Date.now() + 120_000 },
      };
      const first = await mcpCall(root, "fabric_propose", { proposal });
      const taskId = (first.status as { taskId?: string })?.taskId;
      if (!taskId) throw new Error("First MCP client returned no task identity");
      const second = await mcpCall(root, "fabric_status", { taskId });
      if ((second.status as { state?: string })?.state !== "proposed") {
        throw new Error("Second MCP client did not read the first client's proposal");
      }
      const evidence = await mcpCall(root, "fabric_evidence", { taskId });
      const provenance = evidence.provenance as { baseCommit?: string; evidenceDigest?: string };
      if (provenance?.baseCommit !== baseCommit ||
          !/^sha256:[0-9a-f]{64}$/u.test(provenance.evidenceDigest ?? "")) {
        throw new Error("MCP evidence is not bound to the pinned base commit");
      }
      await stopFirstOwner();
      const stopSecondOwner = await startOwner(root);
      try {
        const afterRestart = await mcpCall(root, "fabric_evidence", { taskId });
        if ((afterRestart.provenance as { evidenceDigest?: string })?.evidenceDigest !== provenance.evidenceDigest) {
          throw new Error("Restart changed durable task provenance");
        }
      } finally {
        await stopSecondOwner();
      }
      console.log(JSON.stringify({ ok: true, taskId, baseCommit,
        state: (second.status as { state?: string }).state, evidenceDigest: provenance.evidenceDigest,
        clients: 2, ownerRestarts: 1, modelCalls: 0 }));
  } finally {
    await stopFirstOwner();
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
