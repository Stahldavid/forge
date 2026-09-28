import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import type { Digest } from "./types.ts";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_FINDINGS = 100;

export interface CodexAdversarialFinding {
  severity: "blocker" | "high" | "medium" | "low";
  path: string;
  line?: number;
  title: string;
  explanation: string;
}

export interface CodexAdversarialReport {
  requestDigest: Digest;
  verdict: "pass" | "changes_requested" | "inconclusive";
  summary: string;
  findings: readonly CodexAdversarialFinding[];
}

export interface CodexReviewUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export type CodexAdversarialReviewResult =
  | { state: "reported"; report: CodexAdversarialReport; outputDigest: Digest; usage?: CodexReviewUsage }
  | { state: "inconclusive"; error: string; report?: CodexAdversarialReport; outputDigest?: Digest; usage?: CodexReviewUsage };

export interface CodexAdversarialReviewOptions {
  /** A prepared, exact review checkout. The caller must verify its Git identity and diff before and after this call. */
  workspaceRoot: string;
  /** Canonical digest of the review request and exact diff, supplied by the caller. */
  requestDigest: Digest;
  prompt: string;
  timeoutMs: number;
  maxOutputBytes: number;
  executable?: string;
  signal?: AbortSignal;
  /** Injection point for tests; production uses node:child_process.spawn. */
  spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

function nonEmptyText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !value.includes("\u0000");
}

function validFinding(value: unknown): value is CodexAdversarialFinding {
  if (!isRecord(value) || !exactKeys(value, ["severity", "path", "title", "explanation"], ["line"])) return false;
  if (!["blocker", "high", "medium", "low"].includes(String(value.severity))) return false;
  if (!nonEmptyText(value.path, 512) || value.path.includes("\\") || value.path.startsWith("/") ||
      /^[a-z]:/iu.test(value.path) || value.path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  if (!nonEmptyText(value.title, 500) || !nonEmptyText(value.explanation, 4_000)) return false;
  return value.line === undefined || (Number.isSafeInteger(value.line) && Number(value.line) > 0);
}

function parseReport(text: string, requestDigest: Digest): CodexAdversarialReport | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (!isRecord(value) || !exactKeys(value, ["requestDigest", "verdict", "summary", "findings"])) return undefined;
  if (value.requestDigest !== requestDigest || !["pass", "changes_requested", "inconclusive"].includes(String(value.verdict)) ||
      !nonEmptyText(value.summary, 4_000) || !Array.isArray(value.findings) ||
      value.findings.length > MAX_FINDINGS || !value.findings.every(validFinding)) return undefined;
  if ((value.verdict === "pass" && value.findings.length !== 0) ||
      (value.verdict === "changes_requested" && value.findings.length === 0)) return undefined;
  return value as unknown as CodexAdversarialReport;
}

function parseUsage(value: unknown): CodexReviewUsage | undefined {
  if (!isRecord(value)) return undefined;
  const input = value.input_tokens;
  const output = value.output_tokens;
  const cached = value.cached_input_tokens;
  if (!Number.isSafeInteger(input) || Number(input) < 0 ||
      !Number.isSafeInteger(output) || Number(output) < 0) return undefined;
  return {
    inputTokens: Number(input), outputTokens: Number(output),
    ...(Number.isSafeInteger(cached) && Number(cached) >= 0 ? { cachedInputTokens: Number(cached) } : {}),
  };
}

function parseCodexEvents(stdout: string, requestDigest: Digest):
  { report?: CodexAdversarialReport; usage?: CodexReviewUsage; error?: string } {
  let finalText: string | undefined;
  let usage: CodexReviewUsage | undefined;
  let completed = false;
  let failure = false;
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line) continue;
    let event: unknown;
    try { event = JSON.parse(line); } catch { return { error: "invalid_jsonl" }; }
    if (!isRecord(event) || typeof event.type !== "string") return { error: "invalid_event" };
    if (event.type === "item.completed" && isRecord(event.item) && event.item.type === "agent_message") {
      if (typeof event.item.text !== "string") return { error: "invalid_agent_message" };
      finalText = event.item.text;
    }
    if (event.type === "turn.completed") {
      completed = true;
      usage = parseUsage(event.usage);
    }
    if (event.type === "turn.failed" || event.type === "error") failure = true;
  }
  if (failure) return { error: "codex_turn_failed", usage };
  if (!completed) return { error: "missing_completed_turn", usage };
  if (finalText === undefined) return { error: "missing_agent_report", usage };
  const report = parseReport(finalText, requestDigest);
  if (!report) return { error: "invalid_agent_report", usage };
  return { report, usage };
}

function digestOutput(stdout: Buffer, stderr: Buffer): Digest {
  const hash = createHash("sha256");
  hash.update(stdout);
  hash.update(stderr);
  return `sha256:${hash.digest("hex")}`;
}

/** Codex's read-only sandbox is defense in depth; the caller owns checkout isolation and exact-diff verification. */
export async function runCodexAdversarialReview(options: CodexAdversarialReviewOptions): Promise<CodexAdversarialReviewResult> {
  if (!DIGEST_PATTERN.test(options.requestDigest) || !nonEmptyText(options.prompt, MAX_PROMPT_BYTES) ||
      Buffer.byteLength(options.prompt, "utf8") > MAX_PROMPT_BYTES ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 1 || options.maxOutputBytes > MAX_OUTPUT_BYTES) {
    throw new TypeError("Invalid Codex review bounds or request");
  }
  const workspaceRoot = realpathSync(options.workspaceRoot);
  if (!statSync(workspaceRoot).isDirectory()) throw new TypeError("Codex review workspace must be a directory");
  if (options.signal?.aborted) return { state: "inconclusive", error: "cancelled" };

  const args = ["--sandbox", "read-only", "--ask-for-approval", "never", "exec", "review",
    "--uncommitted", "--json", "--ephemeral", "-"];
  const prompt = `${options.prompt.trimEnd()}\n\nReturn ONLY a JSON object as the final answer with exactly these keys: ` +
    `requestDigest, verdict, summary, findings. Set requestDigest to ${options.requestDigest}. ` +
    `verdict is pass, changes_requested, or inconclusive. Each finding has severity ` +
    `(blocker, high, medium, low), repository-relative path, optional positive line, title, and explanation. ` +
    `Use an empty findings array only for pass or inconclusive. Do not use Markdown fences.\n`;

  return await new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = (options.spawnProcess ?? spawn)(options.executable ?? "codex", args, {
        cwd: workspaceRoot, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      resolve({ state: "inconclusive", error: "spawn_failed" });
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let captured = 0;
    let reason: string | undefined;
    let settled = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (hardTimer) clearTimeout(hardTimer);
      options.signal?.removeEventListener("abort", cancel);
      const out = Buffer.concat(stdout);
      const err = Buffer.concat(stderr);
      const outputDigest = digestOutput(out, err);
      if (reason) {
        resolve({ state: "inconclusive", error: reason, outputDigest });
        return;
      }
      if (code !== 0) {
        resolve({ state: "inconclusive", error: "codex_nonzero_exit", outputDigest });
        return;
      }
      const parsed = parseCodexEvents(out.toString("utf8"), options.requestDigest);
      if (!parsed.report) {
        resolve({ state: "inconclusive", error: parsed.error ?? "invalid_agent_report", outputDigest,
          ...(parsed.usage ? { usage: parsed.usage } : {}) });
        return;
      }
      if (parsed.report.verdict === "inconclusive") {
        resolve({ state: "inconclusive", error: "reviewer_inconclusive", report: parsed.report, outputDigest,
          ...(parsed.usage ? { usage: parsed.usage } : {}) });
        return;
      }
      resolve({ state: "reported", report: parsed.report, outputDigest,
        ...(parsed.usage ? { usage: parsed.usage } : {}) });
    };
    const stop = (why: string) => {
      if (reason || settled) return;
      reason = why;
      child.kill();
      hardTimer = setTimeout(() => finish(null), 2_000);
    };
    const capture = (chunk: Buffer, target: Buffer[]) => {
      if (reason || settled) return;
      const remaining = options.maxOutputBytes - captured;
      if (remaining > 0) {
        const part = chunk.subarray(0, remaining);
        target.push(part);
        captured += part.length;
      }
      if (chunk.length > remaining) stop("output_limit");
    };
    const cancel = () => stop("cancelled");
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, stdout));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, stderr));
    child.on("error", () => stop("spawn_failed"));
    child.on("close", finish);
    const timer = setTimeout(() => stop("timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    child.stdin.on("error", () => stop("stdin_failed"));
    try { child.stdin.end(prompt); } catch { stop("stdin_failed"); }
  });
}
