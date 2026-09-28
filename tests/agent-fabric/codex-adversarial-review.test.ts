import { type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, expect, test } from "bun:test";
import { sha256Digest } from "../../src/forge/agent-fabric/canonical.ts";
import {
  runCodexAdversarialReview, type CodexAdversarialReviewOptions,
} from "../../src/forge/agent-fabric/codex-adversarial-review.ts";

const roots: string[] = [];
const requestDigest = sha256Digest("review request and exact snapshot");

interface FakeChild extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  kill: () => boolean;
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    queueMicrotask(() => child.emit("close", null));
    return true;
  };
  return child;
}

function options(spawnProcess: NonNullable<CodexAdversarialReviewOptions["spawnProcess"]>): CodexAdversarialReviewOptions {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "forge-codex-review-test-"));
  roots.push(workspaceRoot);
  return { workspaceRoot, requestDigest, prompt: "Review the exact change adversarially.", timeoutMs: 500,
    maxOutputBytes: 8_192, spawnProcess };
}

function events(report: unknown, usage = { input_tokens: 80, output_tokens: 20, cached_input_tokens: 8 }): string {
  return [
    JSON.stringify({ type: "thread.started", thread_id: "review-test" }),
    JSON.stringify({ type: "item.completed", item: { id: "message", type: "agent_message", text: JSON.stringify(report) } }),
    JSON.stringify({ type: "turn.completed", usage }),
  ].join("\n") + "\n";
}

function emitResult(child: FakeChild, stdout: string, code = 0): void {
  queueMicrotask(() => {
    child.stdout.write(stdout);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("spawns a bounded read-only Codex review with a digest-bound final report", async () => {
  const child = fakeChild();
  let argv: string[] = [];
  let spawnOptions: SpawnOptionsWithoutStdio | undefined;
  let suppliedPrompt = "";
  child.stdin.on("data", (chunk: Buffer) => { suppliedPrompt += chunk.toString("utf8"); });
  const spawnProcess = (_command: string, args: string[], processOptions: SpawnOptionsWithoutStdio) => {
    argv = args;
    spawnOptions = processOptions;
    emitResult(child, events({ requestDigest, verdict: "pass", summary: "No actionable issue found.", findings: [] }));
    return child as unknown as ChildProcessWithoutNullStreams;
  };
  const result = await runCodexAdversarialReview(options(spawnProcess));
  expect(argv).toEqual(["--sandbox", "read-only", "--ask-for-approval", "never", "exec", "review",
    "--uncommitted", "--json", "--ephemeral", "-"]);
  expect(spawnOptions?.shell).toBe(false);
  expect(suppliedPrompt).toContain(requestDigest);
  expect(result.state).toBe("reported");
  if (result.state === "reported") {
    expect(result.report.verdict).toBe("pass");
    expect(result.outputDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.usage).toEqual({ inputTokens: 80, outputTokens: 20, cachedInputTokens: 8 });
  }
});

test("preserves actionable findings from a distinct reviewer", async () => {
  const child = fakeChild();
  const result = await runCodexAdversarialReview(options(() => {
    emitResult(child, events({ requestDigest, verdict: "changes_requested", summary: "Unsafe condition.", findings: [
      { severity: "high", path: "src/example.ts", line: 12, title: "Unchecked input", explanation: "A caller can bypass the guard." },
    ] }));
    return child as unknown as ChildProcessWithoutNullStreams;
  }));
  expect(result.state).toBe("reported");
  if (result.state === "reported") expect(result.report.findings[0]?.path).toBe("src/example.ts");
});

test.each([
  ["digest mismatch", { requestDigest: sha256Digest("different"), verdict: "pass", summary: "ok", findings: [] }],
  ["empty findings with changes requested", { requestDigest, verdict: "changes_requested", summary: "problem", findings: [] }],
  ["unsafe finding path", { requestDigest, verdict: "changes_requested", summary: "problem", findings: [
    { severity: "high", path: "../secret", title: "escape", explanation: "bad path" },
  ] }],
])("treats %s as inconclusive", async (_label, report) => {
  const child = fakeChild();
  const result = await runCodexAdversarialReview(options(() => {
    emitResult(child, events(report));
    return child as unknown as ChildProcessWithoutNullStreams;
  }));
  expect(result).toMatchObject({ state: "inconclusive", error: "invalid_agent_report" });
});

test("exit zero without a completed turn or valid report is inconclusive", async () => {
  const child = fakeChild();
  const result = await runCodexAdversarialReview(options(() => {
    emitResult(child, JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Looks good" } }) + "\n");
    return child as unknown as ChildProcessWithoutNullStreams;
  }));
  expect(result).toMatchObject({ state: "inconclusive", error: "missing_completed_turn" });
});

test("nonzero exit cannot become a pass even with a valid report", async () => {
  const child = fakeChild();
  const result = await runCodexAdversarialReview(options(() => {
    emitResult(child, events({ requestDigest, verdict: "pass", summary: "ok", findings: [] }), 1);
    return child as unknown as ChildProcessWithoutNullStreams;
  }));
  expect(result).toMatchObject({ state: "inconclusive", error: "codex_nonzero_exit" });
});

test("timeout, cancellation, and output overflow stop the process and remain inconclusive", async () => {
  const timeoutChild = fakeChild();
  const timeout = await runCodexAdversarialReview({ ...options(() => timeoutChild as unknown as ChildProcessWithoutNullStreams), timeoutMs: 5 });
  expect(timeout).toMatchObject({ state: "inconclusive", error: "timeout" });
  expect(timeoutChild.killed).toBe(true);

  const cancelChild = fakeChild();
  const controller = new AbortController();
  const cancelledPromise = runCodexAdversarialReview({
    ...options(() => cancelChild as unknown as ChildProcessWithoutNullStreams), signal: controller.signal,
  });
  controller.abort();
  expect(await cancelledPromise).toMatchObject({ state: "inconclusive", error: "cancelled" });
  expect(cancelChild.killed).toBe(true);

  const overflowChild = fakeChild();
  const overflow = await runCodexAdversarialReview({ ...options(() => {
    emitResult(overflowChild, "x".repeat(200));
    return overflowChild as unknown as ChildProcessWithoutNullStreams;
  }), maxOutputBytes: 16 });
  expect(overflow).toMatchObject({ state: "inconclusive", error: "output_limit" });
  expect(overflowChild.killed).toBe(true);
});
