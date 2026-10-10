import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ProgramWorkerObservation } from "./program-observation.ts";

/** The CLI is cooperative: neither network denial nor process-tree termination is attested. */
export const claudeProgramCapabilities = Object.freeze({ adapter: "claude", protocol: "stream-json", minimumVersion: "2.1.259", isolation: "cooperative", network: "host", structuredOutput: true, threadResume: true, nativeImages: false, hardTokenLimit: false, processTreeTermination: false });
export function validateClaudeProgramVersion(output: string): string {
  const match = /^\s*(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output);
  if (!match) throw new Error("Claude CLI version identity unavailable");
  const [major, minor, patch] = match.slice(1).map(Number);
  if (![major, minor, patch].every(Number.isSafeInteger) || major! < 2 || major === 2 && (minor! < 1 || minor === 1 && patch! < 259)) throw new Error("Claude CLI requires version >=2.1.259 for restricted unattended protocol");
  return `${major}.${minor}.${patch}`;
}
export interface ClaudeProgramInput {
  binary: string; cwd: string; prompt: string; schema: unknown; model?: string; threadId?: string;
  writable: boolean; signal: AbortSignal; environment: NodeJS.ProcessEnv;
  onThread: (id: string) => Promise<void>;
  onEvent: (event: Omit<ProgramWorkerObservation, "id" | "at">) => Promise<void>;
}
export function claudeProgramArguments(input: Pick<ClaudeProgramInput, "schema" | "model" | "threadId" | "writable">): string[] {
  const tools = input.writable ? "Read,Glob,Grep,Edit,Write" : "Read,Glob,Grep";
  return ["--print", "--output-format", "stream-json", "--verbose", "--json-schema", JSON.stringify(input.schema),
    "--restricted", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--disable-slash-commands",
    "--settings", '{"disableAllHooks":true}', "--setting-sources", "", "--permission-mode", "dontAsk", "--permission-prompts", "none",
    "--tools", tools, "--allowedTools", tools, ...(input.model ? ["--model", input.model] : []), ...(input.threadId ? ["--resume", input.threadId] : [])];
}
/** Parse only the documented operational envelope; never persist assistant/tool text. */
export function claudeProgramResult(event: Record<string, unknown>): { data: unknown; usage?: ProgramWorkerObservation["usage"] } {
  if (event.type !== "result" || event.subtype !== "success" || event.is_error === true || !("structured_output" in event)) throw new Error("Claude structured completion not observed");
  return { data: event.structured_output, usage: claudeProgramUsage(event) };
}
export function claudeProgramUsage(event: Record<string, unknown>): ProgramWorkerObservation["usage"] | undefined {
  const raw = event.usage as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  for (const key of ["input_tokens", "output_tokens"]) if (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0) throw new Error("Invalid Claude usage counters");
  for (const key of ["cache_read_input_tokens", "cache_creation_input_tokens"]) if (raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || (raw[key] as number) < 0)) throw new Error("Invalid Claude cache usage");
  const cached = (raw.cache_read_input_tokens as number | undefined) ?? 0;
  const inputTokens = (raw.input_tokens as number) + cached + ((raw.cache_creation_input_tokens as number | undefined) ?? 0);
  if (!Number.isSafeInteger(inputTokens)) throw new Error("Claude aggregate usage exceeds safe counter bound");
  return { input_tokens: inputTokens, cached_input_tokens: cached, output_tokens: raw.output_tokens as number };
}
export async function runClaudeProgramWorker(input: ClaudeProgramInput): Promise<{ data: unknown; usage?: ProgramWorkerObservation["usage"] }> {
  if (process.env.FORGE_FABRIC_TEST_MODE === "1") throw new Error("Real Claude workers forbidden in deterministic test mode");
  if (input.signal.aborted) throw new Error("Claude canceled before dispatch");
  const identity = await promisify(execFile)(input.binary, ["--version"], { cwd: input.cwd, env: input.environment, windowsHide: true, timeout: 10000, maxBuffer: 4096, signal: input.signal }).catch(() => { throw new Error("Claude CLI version inspection failed; model dispatch refused"); });
  const version = validateClaudeProgramVersion(identity.stdout);
  await input.onEvent({ type: "adapter.version", source: "claude", metadata: { version, minimumVersion: claudeProgramCapabilities.minimumVersion } });
  if (input.signal.aborted) throw new Error("Claude canceled before model dispatch");
  return new Promise((resolve, reject) => {
    const child = spawn(input.binary, claudeProgramArguments(input), { cwd: input.cwd, env: input.environment, shell: false, windowsHide: true });
    let pending = "", bytes = 0, count = 0, resultObserved = false, sessionId = input.threadId, final: ReturnType<typeof claudeProgramResult> | undefined;
    let queue = Promise.resolve(), failure: unknown, settled = false, grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: unknown) => { if (settled) return; settled = true; if (grace) clearTimeout(grace); input.signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(final!); };
    const abort = () => { child.kill(); grace ??= setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(new Error("Claude termination/effects unknown; reconcile before retry")); }, 1000); };
    input.signal.addEventListener("abort", abort, { once: true });
    const consume = (line: string) => {
      queue = queue.then(async () => {
        if (settled || failure) return;
        if (++count > 10000) throw new Error("Claude event budget exceeded");
        const event = JSON.parse(line) as Record<string, unknown>;
        if (typeof event.session_id === "string") {
          if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(event.session_id) || sessionId && event.session_id !== sessionId) throw new Error("Claude session identity mismatch");
          if (!sessionId) { sessionId = event.session_id; await input.onThread(sessionId); }
        }
        if (event.type === "result") {
          if (settled) return;
          if (resultObserved) throw new Error("Duplicate Claude result");
          resultObserved = true;
          const usage = claudeProgramUsage(event);
          if (usage) await input.onEvent({ type: "usage", source: "claude", usage, semantics: "incremental" });
          final = claudeProgramResult(event);
        }
      }).catch(error => { failure = error; abort(); });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 4 * 1024 * 1024) { failure = new Error("Claude output budget exceeded"); abort(); return; }
      pending += chunk; let index: number;
      while ((index = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1); if (line) consume(line); }
    });
    child.stderr.on("data", () => {});
    child.once("error", () => finish(new Error("Claude executable unavailable or launch failed")));
    child.once("close", async code => {
      if (pending.trim()) consume(pending.trim()); await queue;
      try {
        await input.onEvent({ type: "process.closed", source: "claude", metadata: { exitCode: code, rootTerminationObserved: true, processTreeTermination: false } });
        finish(failure || input.signal.aborted || code !== 0 || !final ? new Error("Claude completion/effects require reconciliation") : undefined);
      } catch (error) { finish(error); }
    });
    child.stdin.on("error", () => { failure = new Error("Claude input delivery failed"); abort(); });
    child.stdin.end(input.prompt);
    if (input.signal.aborted) abort();
  });
}
