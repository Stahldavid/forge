import { Codex, type CodexOptions, type ThreadOptions, type TurnOptions, type ThreadEvent } from "@openai/codex-sdk";
import { realpath, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export interface CodexWorkerUsage { input_tokens: number; cached_input_tokens: number; output_tokens: number }
export interface CodexWorkerEvent { type: string; threadId?: string; summary?: string; usage?: CodexWorkerUsage }
export interface CodexWorkerInput {
  cwd: string; prompt: string; role: "implementer" | "reviewer" | "investigator" | "decision";
  model?: string; threadId?: string; signal: AbortSignal;
  onEvent: (event: CodexWorkerEvent) => Promise<void> | void;
}
export interface CodexWorkerOutput {
  threadId: string;
  report: { summary: string; verdict?: "approved" | "changes_requested"; findings?: { description: string }[]; selectedNodeIds?: string[]; replanProposal?: string };
  usage?: CodexWorkerUsage; eventsObserved: number;
}
export interface CodexWorkerThread {
  readonly id: string | null;
  runStreamed(prompt: string, options: TurnOptions): Promise<{ events: AsyncIterable<ThreadEvent> }>;
}
export interface CodexWorkerClient {
  startThread(options: ThreadOptions): CodexWorkerThread;
  resumeThread(id: string, options: ThreadOptions): CodexWorkerThread;
}
export type CodexWorkerFactory = (options: CodexOptions) => CodexWorkerClient | Promise<CodexWorkerClient>;
export class CodexWorkerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "CodexWorkerError"; }
}
function fail(code: string, message: string): never { throw new CodexWorkerError(code, message); }
function text(value: unknown, maximum: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && !value.includes("\0"); }
function checkAbort(signal: AbortSignal): void { if (signal.aborted) fail("AF_CODEX_ABORTED", "Codex worker was cancelled; its outcome requires reconciliation"); }

/** Restrict inherited environment while preserving local ChatGPT authentication. */
export function codexWorkerEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp", "tmpdir", "home", "userprofile", "homedrive", "homepath", "appdata", "localappdata", "codex_home", "lang", "lc_all"]);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === "string")) as Record<string, string>;
}

/** Disable each effective inherited server and verify the resulting CLI configuration. */
export async function codexWorkerMcpIsolation(list: (overrides: string[]) => Promise<unknown>): Promise<string[]> {
  const servers = await list([]);
  if (!Array.isArray(servers) || servers.length > 256) fail("AF_CODEX_ISOLATION", "Cannot inspect effective Codex MCP configuration");
  const overrides = servers.flatMap((server) => {
    if (!server || typeof server !== "object" || !text(server.name, 128) || !/^[A-Za-z0-9_-]+$/u.test(server.name)) fail("AF_CODEX_ISOLATION", "Invalid effective Codex MCP server name");
    // Plugin-provided servers may have no root-table transport to merge with.
    // Supply an inert valid transport and explicitly disable it.
    return [`mcp_servers.${server.name}.enabled=false`, `mcp_servers.${server.name}.command=${JSON.stringify(process.execPath)}`, `mcp_servers.${server.name}.args=[]`];
  });
  const observed = await list(overrides);
  if (!Array.isArray(observed) || observed.length > 256 || observed.some((server) => !server || typeof server !== "object" || server.enabled !== false)) fail("AF_CODEX_ISOLATION", "Inherited Codex MCP servers remain enabled");
  return overrides;
}
async function bundledCodexBinary(): Promise<string> {
  const tripleByPlatform: Record<string, string> = { "win32:x64": "x86_64-pc-windows-msvc", "win32:arm64": "aarch64-pc-windows-msvc", "linux:x64": "x86_64-unknown-linux-musl", "linux:arm64": "aarch64-unknown-linux-musl", "darwin:x64": "x86_64-apple-darwin", "darwin:arm64": "aarch64-apple-darwin" };
  const packageByPlatform: Record<string, string> = { "win32:x64": "@openai/codex-win32-x64", "win32:arm64": "@openai/codex-win32-arm64", "linux:x64": "@openai/codex-linux-x64", "linux:arm64": "@openai/codex-linux-arm64", "darwin:x64": "@openai/codex-darwin-x64", "darwin:arm64": "@openai/codex-darwin-arm64" };
  const platform = `${process.platform}:${process.arch}`, triple = tripleByPlatform[platform], packageName = packageByPlatform[platform];
  if (!triple || !packageName) fail("AF_CODEX_ISOLATION", "Unsupported Codex platform");
  const require = createRequire(import.meta.resolve("@openai/codex-sdk")), codexPackage = require.resolve("@openai/codex/package.json");
  const platformPackage = createRequire(codexPackage).resolve(`${packageName}/package.json`);
  const root = join(dirname(platformPackage), "vendor", triple), binary = process.platform === "win32" ? "codex.exe" : "codex";
  for (const path of [join(root, "bin", binary), join(root, "codex", binary)]) if (await stat(path).then((item) => item.isFile(), () => false)) return path;
  fail("AF_CODEX_ISOLATION", "Bundled Codex executable is unavailable");
}
/** Hash observed local SDK/CLI/config inputs; persist hashes, never configuration/auth contents. */
export async function codexWorkerRuntimeIdentity(cwd: string): Promise<string> {
  const digest = createHash("sha256"), binary = await bundledCodexBinary();
  digest.update(binary); digest.update(await readFile(binary)); digest.update(await readFile(fileURLToPath(import.meta.resolve("@openai/codex-sdk"))));
  const paths = [join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml"), join(cwd, ".codex/config.toml")];
  for (const [index, path] of paths.entries()) { digest.update(index === 0 ? path : "project-config"); try { digest.update(await readFile(path)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; digest.update("absent"); } }
  return `sha256:${digest.digest("hex")}`;
}
const exec = promisify(execFile);
export async function codexWorkerIsolationOverrides(cwd: string, signal: AbortSignal): Promise<string[]> {
  const executable = await bundledCodexBinary();
  const overrides = await codexWorkerMcpIsolation(async (overrides) => {
    const args = ["--cd", cwd, ...overrides.flatMap((override) => ["--config", override]), "mcp", "list", "--json"];
    const output = await exec(executable, args, { cwd, env: codexWorkerEnvironment(), signal, timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "utf8" });
    return JSON.parse(output.stdout);
  });
  return overrides;
}
async function isolatedCodexClient(options: CodexOptions, cwd: string, signal: AbortSignal): Promise<CodexWorkerClient> {
  return new Codex({ ...options, configOverrides: await codexWorkerIsolationOverrides(cwd, signal) });
}
const reportSchema = {
  type: "object", additionalProperties: false,
  required: ["summary", "verdict", "findings", "selectedNodeIds", "replanProposal"],
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 4096 },
    verdict: { anyOf: [{ type: "string", enum: ["approved", "changes_requested"] }, { type: "null" }] },
    findings: { type: "array", maxItems: 128, items: { type: "object", additionalProperties: false, required: ["description"], properties: { description: { type: "string", minLength: 1, maxLength: 4096 } } } },
    selectedNodeIds: { type: "array", maxItems: 128, items: { type: "string", minLength: 1, maxLength: 128 } },
    replanProposal: { anyOf: [{ type: "string", minLength: 1, maxLength: 4096 }, { type: "null" }] },
  },
};
function validateReport(raw: string, role: CodexWorkerInput["role"]): CodexWorkerOutput["report"] {
  if (Buffer.byteLength(raw) > 64 * 1024) fail("AF_CODEX_REPORT", "Codex report exceeds its size limit");
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail("AF_CODEX_REPORT", "Codex did not return a JSON report"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("AF_CODEX_REPORT", "Invalid Codex report object");
  const report = data as Record<string, unknown>;
  const keys = Object.keys(report);
  if (keys.length !== 5 || keys.some((key) => !Object.keys(reportSchema.properties).includes(key)) || !text(report.summary, 4096)) fail("AF_CODEX_REPORT", "Invalid Codex report fields");
  if (report.verdict !== null && report.verdict !== "approved" && report.verdict !== "changes_requested") fail("AF_CODEX_REPORT", "Invalid Codex review verdict");
  if (!Array.isArray(report.findings) || report.findings.length > 128 || report.findings.some((finding) => !finding || typeof finding !== "object" || Array.isArray(finding) || Object.keys(finding).length !== 1 || !text(finding.description, 4096))) fail("AF_CODEX_REPORT", "Invalid Codex findings");
  if (!Array.isArray(report.selectedNodeIds) || report.selectedNodeIds.length > 128 || report.selectedNodeIds.some((id) => !text(id, 128) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(id)) || new Set(report.selectedNodeIds).size !== report.selectedNodeIds.length) fail("AF_CODEX_REPORT", "Invalid Codex branch selection");
  if (report.replanProposal !== null && !text(report.replanProposal, 4096)) fail("AF_CODEX_REPORT", "Invalid Codex replan proposal");
  if (role === "reviewer" && report.verdict === null) fail("AF_CODEX_REPORT", "Reviewer report requires an explicit verdict");
  if (report.verdict === "approved" && report.findings.length > 0) fail("AF_CODEX_REPORT", "Approved review cannot contain unresolved findings");
  return { summary: report.summary, ...(report.verdict !== null ? { verdict: report.verdict as "approved" | "changes_requested" } : {}), findings: report.findings as { description: string }[], selectedNodeIds: report.selectedNodeIds as string[], ...(report.replanProposal !== null ? { replanProposal: report.replanProposal as string } : {}) };
}
function usage(value: unknown): CodexWorkerUsage {
  if (!value || typeof value !== "object") fail("AF_CODEX_EVENT", "Invalid Codex usage");
  const report = value as Record<string, unknown>;
  for (const key of ["input_tokens", "cached_input_tokens", "output_tokens"]) if (!Number.isSafeInteger(report[key]) || (report[key] as number) < 0) fail("AF_CODEX_EVENT", "Invalid Codex usage counters");
  return { input_tokens: report.input_tokens as number, cached_input_tokens: report.cached_input_tokens as number, output_tokens: report.output_tokens as number };
}

/** Real SDK streaming with explicit completion; callbacks contain metadata only. */
async function runCodexWorkerInternal(input: CodexWorkerInput, factory: CodexWorkerFactory): Promise<CodexWorkerOutput> {
  if (!input || !["implementer", "reviewer", "investigator", "decision"].includes(input.role) || !text(input.prompt, 128 * 1024) || !text(input.cwd, 4096) || typeof input.onEvent !== "function" || !input.signal || typeof input.signal.aborted !== "boolean") fail("AF_CODEX_INPUT", "Invalid Codex worker input");
  if (input.model !== undefined && !text(input.model, 128)) fail("AF_CODEX_INPUT", "Invalid Codex model");
  if (input.threadId !== undefined && (!text(input.threadId, 128) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(input.threadId))) fail("AF_CODEX_INPUT", "Invalid Codex thread ID");
  checkAbort(input.signal);
  const cwd = await realpath(input.cwd);
  if (!(await stat(cwd)).isDirectory()) fail("AF_CODEX_INPUT", "Codex working directory must be a directory");
  const client = await factory({ env: codexWorkerEnvironment(), config: { mcp_servers: {}, web_search: "disabled", approval_policy: "never", sandbox_workspace_write: { network_access: false }, shell_environment_policy: { inherit: "none", set: {} } } });
  const options: ThreadOptions = { workingDirectory: cwd, sandboxMode: input.role === "implementer" ? "workspace-write" : "read-only", networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never", ...(input.model ? { model: input.model } : {}) };
  const thread = input.threadId ? client.resumeThread(input.threadId, options) : client.startThread(options);
  let threadId = input.threadId ?? thread.id ?? "", finalMessage: string | undefined, completed = false, eventsObserved = 0, reportedUsage: CodexWorkerUsage | undefined;
  const stream = await thread.runStreamed(`${input.prompt}\n\nReturn the structured report requested by the output schema. Role: ${input.role}. Never include credentials in reports. Use null for inapplicable verdict/replanProposal, and empty arrays for absent findings/branch selection.`, { outputSchema: reportSchema, signal: input.signal });
  for await (const event of stream.events) {
    checkAbort(input.signal);
    if (++eventsObserved > 10000) fail("AF_CODEX_EVENT_LIMIT", "Codex worker event limit exceeded; reconcile its thread");
    if (!["thread.started", "turn.started", "item.completed", "item.started", "item.updated", "turn.completed", "turn.failed", "error"].includes(event.type)) fail("AF_CODEX_EVENT", "Unknown Codex event type");
    let notification: CodexWorkerEvent = { type: event.type };
    if (event.type === "thread.started") {
      if (!text(event.thread_id, 128) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(event.thread_id) || (threadId && threadId !== event.thread_id)) fail("AF_CODEX_EVENT", "Codex thread identity changed");
      threadId = event.thread_id; notification = { type: event.type, threadId };
    } else if (event.type === "item.completed" || event.type === "item.started" || event.type === "item.updated") {
      if (!["command_execution", "file_change", "mcp_tool_call", "agent_message", "reasoning", "web_search", "error", "todo_list"].includes(event.item.type)) fail("AF_CODEX_EVENT", "Unknown Codex item type");
      notification.summary = `Codex ${event.item.type}`;
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        if (completed || !text(event.item.text, 64 * 1024)) fail("AF_CODEX_REPORT", "Invalid Codex response ordering or size");
        finalMessage = event.item.text;
      }
    } else if (event.type === "turn.completed") {
      if (completed) fail("AF_CODEX_EVENT", "Duplicate Codex completion");
      completed = true; reportedUsage = usage(event.usage); notification.usage = reportedUsage;
    } else if (event.type === "turn.failed" || event.type === "error") {
      await input.onEvent({ type: event.type, ...(threadId ? { threadId } : {}), summary: "Codex execution failed; reconcile before retrying" });
      fail("AF_CODEX_TURN_FAILED", "Codex execution failed; reconcile before retrying");
    }
    await input.onEvent(notification);
  }
  checkAbort(input.signal);
  if (!completed || !threadId || finalMessage === undefined) fail("AF_CODEX_INCOMPLETE", "Codex stream ended without a completed report; reconcile its thread");
  return { threadId, report: validateReport(finalMessage, input.role), ...(reportedUsage ? { usage: reportedUsage } : {}), eventsObserved };
}

export async function runCodexWorker(input: CodexWorkerInput, factory?: CodexWorkerFactory): Promise<CodexWorkerOutput> {
  try { return await runCodexWorkerInternal(input, factory ?? ((options) => isolatedCodexClient(options, input.cwd, input.signal))); }
  catch (error) {
    if (error instanceof CodexWorkerError) throw error;
    if (input?.signal?.aborted) fail("AF_CODEX_ABORTED", "Codex worker was cancelled; its outcome requires reconciliation");
    fail("AF_CODEX_EXECUTION", "Codex SDK or event persistence failed; reconcile its thread before retrying");
  }
}

/** V2 keeps the operational envelope outside the activity's owner-registered schema. */
async function runTypedCodexWorkerInternal(input: CodexWorkerInput & { outputSchema: unknown; validateOutput: (data: unknown) => void }, factory?: CodexWorkerFactory): Promise<{ threadId: string; data: unknown; usage?: CodexWorkerUsage }> {
  if (!input || !text(input.prompt, 128 * 1024) || !text(input.cwd, 4096) || !["implementer", "reviewer", "investigator", "decision"].includes(input.role) || typeof input.validateOutput !== "function") fail("AF_CODEX_INPUT", "Invalid typed worker input");
  checkAbort(input.signal); const cwd = await realpath(input.cwd);
  const options: CodexOptions = { env: codexWorkerEnvironment(), config: { mcp_servers: {}, web_search: "disabled", approval_policy: "never", sandbox_workspace_write: { network_access: false }, shell_environment_policy: { inherit: "none", set: {} } } };
  const client = await (factory ?? ((configuration) => isolatedCodexClient(configuration, cwd, input.signal)))(options);
  const threadOptions: ThreadOptions = { workingDirectory: cwd, sandboxMode: input.role === "implementer" ? "workspace-write" : "read-only", networkAccessEnabled: false, webSearchMode: "disabled", approvalPolicy: "never", ...(input.model ? { model: input.model } : {}) };
  const thread = input.threadId ? client.resumeThread(input.threadId, threadOptions) : client.startThread(threadOptions);
  let threadId = input.threadId ?? thread.id ?? "", finalMessage: string | undefined, completed = false, count = 0, observedUsage: CodexWorkerUsage | undefined;
  const stream = await thread.runStreamed(`${input.prompt}\nReturn only data matching the requested output schema. Never include credentials.`, { outputSchema: input.outputSchema, signal: input.signal });
  for await (const event of stream.events) {
    checkAbort(input.signal); if (++count > 10000) fail("AF_CODEX_EVENT_LIMIT", "Typed worker event budget exceeded");
    if (!["thread.started", "turn.started", "item.completed", "item.started", "item.updated", "turn.completed", "turn.failed", "error"].includes(event.type)) fail("AF_CODEX_EVENT", "Unknown typed event");
    if (event.type === "thread.started") { if (!text(event.thread_id, 128) || !/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(event.thread_id) || threadId && threadId !== event.thread_id) fail("AF_CODEX_EVENT", "Thread identity changed"); threadId = event.thread_id; await input.onEvent({ type: event.type, threadId }); }
    else if (event.type === "item.completed" && event.item.type === "agent_message") { if (completed || !text(event.item.text, 4 * 1024 * 1024)) fail("AF_CODEX_REPORT", "Invalid typed message"); finalMessage = event.item.text; }
    else if (event.type === "turn.completed") { if (completed) fail("AF_CODEX_EVENT", "Duplicate completion"); completed = true; observedUsage = usage(event.usage); await input.onEvent({ type: event.type, usage: observedUsage }); }
    else if (event.type === "turn.failed" || event.type === "error") fail("AF_CODEX_TURN_FAILED", "Typed worker failed; reconcile before retry");
  }
  checkAbort(input.signal); if (!completed || !threadId || !finalMessage) fail("AF_CODEX_INCOMPLETE", "Typed worker completion not observed");
  let data: unknown; try { data = JSON.parse(finalMessage); input.validateOutput(data); } catch { fail("AF_CODEX_REPORT", "Typed worker output schema invalid"); }
  return { threadId, data, ...(observedUsage ? { usage: observedUsage } : {}) };
}
export async function runTypedCodexWorker(input: CodexWorkerInput & { outputSchema: unknown; validateOutput: (data: unknown) => void }, factory?: CodexWorkerFactory): Promise<{ threadId: string; data: unknown; usage?: CodexWorkerUsage }> {
  try { return await runTypedCodexWorkerInternal(input, factory); }
  catch (error) { if (error instanceof CodexWorkerError) throw error; fail("AF_CODEX_EXECUTION", "Typed SDK or persistence failed; reconcile before retry"); }
}
