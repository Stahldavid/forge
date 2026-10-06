import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryManifest } from "../repository-manifest/types.ts";
import { containedRepositoryPath, validateRepositoryManifest } from "../repository-manifest/index.ts";
import { analyzeRepository, repositoryManifestHash } from "./analyze.ts";
import { repositoryScenarioHash, repositorySnapshotId, sameRepositoryPath } from "./identity.ts";
import { isSensitiveRepositoryPath, repositoryGlobMatches, scanRepository } from "./scanner.ts";
import { collectRuntimeArtifact, isRuntimeArtifactLimitation, validateRuntimeFact, type RuntimeFact } from "./runtime-artifacts.ts";
import type { RepositorySnapshot } from "./types.ts";

type Observation = NonNullable<RepositoryManifest["runtime"]>["observations"][number];
export interface RuntimeObservationBinding { root: string; snapshotId: string; manifestHash: string; scenarioHash: string; inputDigest: string }
export interface RuntimeObservationCommandResult { status: "completed" | "failed" | "timed-out" | "cancelled"; exitCode: number | null; durationMs: number }
export interface RuntimeObservationResult {
  id: string; component: string; status: "completed" | "failed" | "timed-out" | "cancelled";
  commands: RuntimeObservationCommandResult[];
  artifacts: Array<{ path: string; format: Observation["artifacts"][number]["format"]; digest: string }>;
  facts: RuntimeFact[]; limitations: string[];
}
export interface RuntimeObservationReport {
  schemaVersion: 1; kind: "repository-runtime-observation"; reportId: string; digest: string;
  binding: RuntimeObservationBinding; environmentId: string; createdAt: string; expiresAt: string;
  isolation: "temporary-copy"; completeness: "partial"; identitiesAuthenticated: false;
  tooling: { node: string; platform: string; architecture: string };
  observations: RuntimeObservationResult[]; limitations: string[];
}
export interface ObserveRepositoryRuntimeOptions { environmentId: string; observationId?: string; write?: boolean; signal?: AbortSignal }
export interface ReadRuntimeObservationOptions { environmentId?: string; maxAgeMs?: number }
const ARTIFACT_BYTES = 2 * 1024 * 1024, REPORT_BYTES = 4 * 1024 * 1024, TTL_MS = 15 * 60 * 1000, RUN_BUDGET_MS = 300000;
const PRIVATE_DIRECTORIES = new Set([".git", ".forge", "node_modules", ".nuxt", ".output", ".next", "target", "build", "dist", "coverage", ".gradle", ".aws", ".ssh", ".secrets", ".idea", ".vscode", ".codex", ".docker", ".npm", ".azure"]);
const REPORT_LIMITATIONS = ["Facts describe artifacts exported by declared commands in this source copy and environment; they do not prove production behavior or exhaustive runtime coverage.", "Environment identity is a caller-supplied label, not an authenticated host identity.", "The copy has no repository history, dependencies or credentials. Commands have normal host/network permissions; this is not a security sandbox."];
const RESULT_LIMITATIONS = ["Command did not complete; no artifact facts were accepted.", "Runtime command or artifact collection failed; no facts were accepted.", "Total runtime execution budget exhausted."];
const keys = (value: object, expected: string[]) => Object.keys(value).every(key => expected.includes(key));
const essentialInput = (name: string) => /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|forge\.manifest\.json|pom\.xml|gradle\.lockfile|(?:build|settings)\.gradle(?:\.kts)?|.+\.config\.[cm]?[jt]s|.+\.(?:[cm]?[jt]sx?|java|gradle|kts))$/i.test(name);
const label = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value);
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;
const digest = (value: unknown) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
const bytesDigest = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const normalized = (value: string) => value.split(sep).join("/");

function declarations(manifest: RepositoryManifest, environmentId: string, observationId?: string): Observation[] {
  if (!label(environmentId)) throw new Error("Runtime environmentId must be a non-sensitive label");
  const valid = validateRepositoryManifest(manifest);
  if (!valid.manifest) throw new Error(`Invalid runtime manifest: ${valid.diagnostics.join("; ")}`);
  const observations = manifest.runtime?.observations ?? [];
  if (!observations.length) throw new Error("Manifest has no runtime observations");
  if (observations.some(item => item.commands.some(command => /[*?\[\]]/.test(command.argv[0])))) throw new Error("Runtime executable must be a literal filename");
  if (observationId !== undefined && (!label(observationId) || !observations.some(item => item.id === observationId))) throw new Error("Unknown runtime observation id");
  return observations.filter(item => observationId === undefined || item.id === observationId);
}

/** A reviewable execution plan. This function never reads files or launches processes. */
export function planRepositoryRuntime(snapshot: RepositorySnapshot, environmentId: string, observationId?: string) {
  const observations = declarations(snapshot.manifest, environmentId, observationId);
  if (snapshot.manifestHash !== repositoryManifestHash(snapshot.manifest) || snapshot.scenarioHash !== repositoryScenarioHash(snapshot.manifest) || snapshot.snapshotId !== repositorySnapshotId(snapshot)) throw new Error("Invalid runtime snapshot binding");
  return { kind: "repository-runtime-plan" as const, schemaVersion: 1 as const, environmentId,
    snapshotId: snapshot.snapshotId, manifestHash: snapshot.manifestHash, scenarioHash: snapshot.scenarioHash,
    execution: "not-executed" as const, isolation: "temporary-copy" as const,
    observations: JSON.parse(JSON.stringify(observations)) as Observation[],
    limitations: ["A source copy isolates repository edits, but is not an operating-system or network security sandbox.", "Dependencies and credentials are not copied or installed; commands must explicitly prepare any required environment."] };
}

interface InputInventory { hashes: Record<string, string>; digest: string }
/** Copies regular safe files, including current uncommitted edits and deletions, without Git history or dependency links. */
function inventory(root: string, manifest: RepositoryManifest, destination?: string): InputInventory {
  const hashes: Record<string, string> = Object.create(null); let entries = 0, total = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 50000) throw new Error("Runtime input inventory exceeds 50000 entries");
      const absolute = join(directory, entry.name), path = normalized(relative(root, absolute));
      if (isSensitiveRepositoryPath(path) || PRIVATE_DIRECTORIES.has(entry.name.toLowerCase()) || !essentialInput(entry.name) && entry.isFile() && manifest.exclude?.some(pattern => repositoryGlobMatches(path, pattern))) continue;
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { containedRepositoryPath(root, path); visit(absolute); continue; }
      if (!stat.isFile()) continue;
      containedRepositoryPath(root, path);
      if (stat.size > 16 * 1024 * 1024 || (total += stat.size) > 256 * 1024 * 1024) throw new Error("Runtime source copy exceeds its size budget");
      const content = readFileSync(absolute), after = lstatSync(absolute);
      if (!after.isFile() || after.isSymbolicLink() || stat.ino !== after.ino || stat.mtimeMs !== after.mtimeMs || stat.size !== after.size) throw new Error("Runtime input changed while preparing copy");
      containedRepositoryPath(root, path);
      hashes[path] = bytesDigest(content);
      if (destination) { const target = containedRepositoryPath(destination, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content, { mode: stat.mode & 0o777 }); }
    }
  };
  visit(root);
  return { hashes, digest: digest(hashes) };
}

/** Root-neutral digest of the exact safe execution-copy inputs, including files outside analysis globs. */
export function runtimeSourceDigest(rootInput: string, manifest: RepositoryManifest): string {
  if (!validateRepositoryManifest(manifest).manifest) throw new Error("Invalid runtime source manifest");
  return inventory(realpathSync(rootInput), manifest).digest;
}

function assertSnapshotFresh(root: string, snapshot: RepositorySnapshot): void {
  if (!sameRepositoryPath(realpathSync(root), snapshot.root) || snapshot.manifestHash !== repositoryManifestHash(snapshot.manifest) || snapshot.scenarioHash !== repositoryScenarioHash(snapshot.manifest) || snapshot.snapshotId !== repositorySnapshotId(snapshot)) throw new Error("Runtime observation snapshot binding mismatch");
  const scan = scanRepository(root, snapshot.manifest);
  const hashes = Object.fromEntries(scan.sources.map(source => [source.path, source.hash]));
  const expected = Object.fromEntries(Object.entries(snapshot.files).map(([path, file]) => [path, file.hash]));
  if (digest(hashes) !== digest(expected)) throw new Error("Runtime observation source snapshot is stale");
}

function commandEnvironment(scratch: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC"]) if (process.env[name]) env[name] = process.env[name];
  const home = join(scratch, "home"), temp = join(scratch, "tmp"); mkdirSync(home, { recursive: true }); mkdirSync(temp, { recursive: true });
  Object.assign(env, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), TMPDIR: temp, TEMP: temp, TMP: temp, CI: "1", FORGE_RUNTIME_OBSERVATION: "1" });
  return env;
}

async function stopOwnedGroup(pid: number): Promise<void> {
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
}

// A suspended process cannot create descendants before assignment to its job.
// The wrapper owns the job handle; its closure on timeout, cancellation or normal
// completion terminates every descendant, including children whose parent exited.
const WINDOWS_JOB_SCRIPT = String.raw`param([string]$Request)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ForgeRuntimeJob {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public uint cb; public string reserved,desktop,title; public uint x,y,xsize,ysize,xchars,ychars,fill,flags; public ushort show,reserved2; public IntPtr reservedPtr,input,output,error; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process,thread; public uint pid,tid; }
 [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcessMemory,peakJobMemory; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,IntPtr data,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string application,StringBuilder command,IntPtr procAttrs,IntPtr threadAttrs,bool inherit,uint flags,IntPtr environment,string directory,ref STARTUPINFO startup,out PROCESS_INFORMATION info);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static string Quote(string value) { var result=new StringBuilder("\""); int slashes=0; foreach(char c in value) { if(c=='\\'){slashes++;continue;} if(c=='"'){result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;} result.Append('\\',slashes);slashes=0;result.Append(c); } result.Append('\\',slashes*2);return result.Append('"').ToString(); }
 public static int Run(string executable,string[] argv,string directory) {
  IntPtr job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero)throw new Exception("job");
  PROCESS_INFORMATION process=new PROCESS_INFORMATION(); IntPtr limits=IntPtr.Zero;
  try { var limit=new EXTENDED_LIMIT(); limit.basic.flags=0x2000; int size=Marshal.SizeOf(limit); limits=Marshal.AllocHGlobal(size); Marshal.StructureToPtr(limit,limits,false); if(!SetInformationJobObject(job,9,limits,(uint)size))throw new Exception("limits");
   var command=new StringBuilder(Quote(executable)); foreach(var arg in argv)command.Append(' ').Append(Quote(arg)); var startup=new STARTUPINFO();startup.cb=(uint)Marshal.SizeOf(startup);
   if(!CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,directory,ref startup,out process))throw new Exception("start");
   if(!AssignProcessToJobObject(job,process.process)){TerminateProcess(process.process,93);throw new Exception("assignment");}
   if(ResumeThread(process.thread)==0xffffffff){TerminateProcess(process.process,93);throw new Exception("resume");}
   WaitForSingleObject(process.process,0xffffffff);uint code;if(!GetExitCodeProcess(process.process,out code))throw new Exception("exit");return unchecked((int)code);
  } finally { if(job!=IntPtr.Zero)CloseHandle(job);if(process.thread!=IntPtr.Zero)CloseHandle(process.thread);if(process.process!=IntPtr.Zero)CloseHandle(process.process);if(limits!=IntPtr.Zero)Marshal.FreeHGlobal(limits); }
 }
}
'@
$config=Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json
$executable=(Get-Command -Name $config.argv[0] -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$arguments=@();if($config.argv.Length -gt 1){$arguments=@($config.argv[1..($config.argv.Length-1)])}
exit [ForgeRuntimeJob]::Run($executable,[string[]]$arguments,[string]$config.cwd)
`;

function commandLaunch(command: Observation["commands"][number], cwd: string, env: NodeJS.ProcessEnv): { executable: string; argv: string[] } {
  if (process.platform !== "win32") return { executable: command.argv[0], argv: command.argv.slice(1) };
  const script = join(env.TEMP!, "forge-runtime-job.ps1"), request = join(env.TEMP!, `command-${randomUUID()}.json`);
  if (!existsSync(script)) writeFileSync(script, WINDOWS_JOB_SCRIPT, { flag: "wx" });
  writeFileSync(request, JSON.stringify({ argv: command.argv, cwd }), { flag: "wx" });
  return { executable: join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), argv: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Request", request] };
}

async function runCommand(command: Observation["commands"][number], directory: string, env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<RuntimeObservationCommandResult> {
  const started = Date.now();
  if (signal?.aborted) return { status: "cancelled", exitCode: null, durationMs: 0 };
  const launch = commandLaunch(command, directory, env);
  const child = spawn(launch.executable, launch.argv, { cwd: directory, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "ignore", "ignore"], env });
  let status: RuntimeObservationCommandResult["status"] | undefined, cleanup: Promise<void> | undefined, cleanupError: Error | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  let stopWait: ((code: number | null) => void) | undefined;
  const stop = (reason: "cancelled" | "timed-out") => {
    status ??= reason;
    cleanupTimer ??= setTimeout(() => { cleanupError = new Error("Runtime process did not exit after termination"); stopWait?.(null); }, 10000);
    if (child.pid) cleanup ??= (process.platform === "win32" ? Promise.resolve().then(() => { child.kill("SIGKILL"); }) : stopOwnedGroup(child.pid)).catch(() => { cleanupError = new Error("Runtime process cleanup failed"); stopWait?.(null); });
  };
  const cancel = () => stop("cancelled"); signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => stop("timed-out"), command.timeoutMs ?? 30000);
  const exitCode = await new Promise<number | null>((accept) => { stopWait = accept; child.once("error", () => { status ??= "failed"; accept(null); }); child.once("exit", (code) => accept(code)); });
  clearTimeout(timer); signal?.removeEventListener("abort", cancel);
  if (cleanupTimer) clearTimeout(cleanupTimer);
  if (child.pid && (cleanup || process.platform !== "win32")) await (cleanup ?? stopOwnedGroup(child.pid));
  if (cleanupError) throw cleanupError;
  return { status: status ?? (exitCode === 0 ? "completed" : "failed"), exitCode, durationMs: Date.now() - started };
}

function reportDigest(report: Omit<RuntimeObservationReport, "digest"> | RuntimeObservationReport): string { const { digest: _ignored, ...content } = report as RuntimeObservationReport; return digest(content); }
function reportFile(root: string): string { return containedRepositoryPath(root, ".forge/repository/runtime-observation.json"); }
function publishReport(root: string, report: RuntimeObservationReport, manifest: RepositoryManifest): void {
  const path = reportFile(root), directory = dirname(path); mkdirSync(directory, { recursive: true }); containedRepositoryPath(root, ".forge/repository");
  const lock = containedRepositoryPath(root, ".forge/repository/.runtime-observation.lock"), temporary = join(directory, `.runtime-observation-${randomUUID()}.tmp`);
  writeFileSync(lock, report.reportId, { flag: "wx" });
  try {
    if (inventory(root, manifest).digest !== report.binding.inputDigest) throw new Error("Runtime source changed before report publication");
    const text = JSON.stringify(report, null, 2); if (Buffer.byteLength(text) > REPORT_BYTES) throw new Error("Runtime report exceeds size budget");
    writeFileSync(temporary, text, { flag: "wx" }); containedRepositoryPath(root, ".forge/repository/runtime-observation.json"); renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); unlinkSync(lock); }
}

/** Explicit opt-in execution. Static discovery/analysis never invokes this runner. */
export async function observeRepositoryRuntime(rootInput: string, manifestInput: RepositoryManifest, options: ObserveRepositoryRuntimeOptions): Promise<RuntimeObservationReport> {
  const root = realpathSync(rootInput), manifest = JSON.parse(JSON.stringify(manifestInput)) as RepositoryManifest;
  const observations = declarations(manifest, options.environmentId, options.observationId);
  const snapshot = await analyzeRepository(root, manifest, { write: false }); planRepositoryRuntime(snapshot, options.environmentId, options.observationId);
  const scratch = mkdtempSync(join(tmpdir(), "forge-runtime-observation-")), checkout = join(scratch, "checkout"); mkdirSync(checkout);
  let safeToRemove = true;
  try {
    const before = inventory(root, manifest, checkout); assertSnapshotFresh(root, snapshot);
    const binding = { root, snapshotId: snapshot.snapshotId, manifestHash: snapshot.manifestHash, scenarioHash: snapshot.scenarioHash, inputDigest: before.digest };
    const results: RuntimeObservationResult[] = [], env = commandEnvironment(scratch), deadline = Date.now() + RUN_BUDGET_MS;
    for (const observation of observations) {
      const result: RuntimeObservationResult = { id: observation.id, component: observation.component, status: "completed", commands: [], artifacts: [], facts: [], limitations: [] }; results.push(result);
      if (options.signal?.aborted) { result.status = "cancelled"; continue; }
      if (Date.now() >= deadline) { result.status = "timed-out"; result.limitations.push("Total runtime execution budget exhausted."); continue; }
      try {
        for (const artifact of observation.artifacts) { const path = containedRepositoryPath(checkout, artifact.path); if (existsSync(path)) { if (!lstatSync(path).isFile()) throw new Error("Runtime artifact must be a regular file"); unlinkSync(path); } }
        for (const command of observation.commands) {
          const component = manifest.components.find(item => item.id === observation.component)!;
          const directory = containedRepositoryPath(checkout, command.cwd ?? component.root);
          if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new Error("Runtime command working directory is unavailable");
          let execution: RuntimeObservationCommandResult;
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) { result.status = "timed-out"; break; }
          try { execution = await runCommand({ ...command, timeoutMs: Math.min(command.timeoutMs ?? 30000, remainingMs) }, directory, env, options.signal); } catch { safeToRemove = false; throw new Error("Runtime process cleanup failed; temporary copy was preserved"); }
          result.commands.push(execution); if (execution.status !== "completed") { result.status = execution.status; break; }
        }
        if (result.status !== "completed") { result.limitations.push("Command did not complete; no artifact facts were accepted."); continue; }
        for (const artifact of observation.artifacts) {
          if (isSensitiveRepositoryPath(artifact.path)) throw new Error("Sensitive runtime artifact paths are forbidden");
          const path = containedRepositoryPath(checkout, artifact.path), stat = lstatSync(path);
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ARTIFACT_BYTES) throw new Error("Runtime artifact is missing, unsafe or too large");
          const content = readFileSync(path), after = lstatSync(path);
          if (after.isSymbolicLink() || stat.ino !== after.ino || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs) throw new Error("Runtime artifact changed while being collected");
          containedRepositoryPath(checkout, artifact.path);
          const collected = collectRuntimeArtifact(artifact.format, content.toString("utf8"), observation.component);
          result.artifacts.push({ path: artifact.path, format: artifact.format, digest: bytesDigest(content) }); result.facts.push(...collected.facts); result.limitations.push(...collected.limitations);
          if (result.facts.length > 2000) throw new Error("Runtime fact budget exceeded");
        }
      } catch (error) {
        if (!safeToRemove) throw error;
        result.status = "failed"; result.facts = []; result.artifacts = []; result.limitations = ["Runtime command or artifact collection failed; no facts were accepted."];
      }
    }
    if (inventory(root, manifest).digest !== before.digest) throw new Error("Runtime source changed during observation"); assertSnapshotFresh(root, snapshot);
    const createdAt = new Date().toISOString();
    const content: Omit<RuntimeObservationReport, "digest"> = { schemaVersion: 1, kind: "repository-runtime-observation", reportId: `runtime:${randomUUID()}`, binding, environmentId: options.environmentId,
      createdAt, expiresAt: new Date(Date.parse(createdAt) + TTL_MS).toISOString(), isolation: "temporary-copy", completeness: "partial", identitiesAuthenticated: false, observations: results,
      tooling: { node: process.version, platform: process.platform, architecture: process.arch },
      limitations: REPORT_LIMITATIONS };
    const report: RuntimeObservationReport = { ...content, digest: reportDigest(content) };
    if (Buffer.byteLength(JSON.stringify(report)) > REPORT_BYTES) throw new Error("Runtime report exceeds size budget");
    if (options.write) publishReport(root, report, manifest);
    return report;
  } finally {
    if (safeToRemove) { if (!scratch.startsWith(join(tmpdir(), "forge-runtime-observation-"))) throw new Error("Unsafe runtime copy cleanup"); rmSync(scratch, { recursive: true, force: true }); }
  }
}

function validateReport(value: unknown): asserts value is RuntimeObservationReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid runtime report");
  const report = value as RuntimeObservationReport;
  if (!keys(report, ["schemaVersion", "kind", "reportId", "digest", "binding", "environmentId", "createdAt", "expiresAt", "isolation", "completeness", "identitiesAuthenticated", "tooling", "observations", "limitations"]) || report.schemaVersion !== 1 || report.kind !== "repository-runtime-observation" || report.isolation !== "temporary-copy" || report.completeness !== "partial" || report.identitiesAuthenticated !== false || !/^runtime:[a-f0-9-]{36}$/.test(report.reportId) || !label(report.environmentId) || !report.binding || !Array.isArray(report.observations) || report.observations.length > 32 || !Array.isArray(report.limitations) || report.limitations.some(item => !REPORT_LIMITATIONS.includes(item)) || report.digest !== reportDigest(report)) throw new Error("Invalid runtime report integrity");
  if (!keys(report.binding, ["root", "snapshotId", "manifestHash", "scenarioHash", "inputDigest"]) || typeof report.binding.root !== "string" || report.binding.root.length > 4096 || !/^repo:[a-f0-9]{64}$/.test(report.binding.snapshotId) || !/^[a-f0-9]{64}$/.test(report.binding.manifestHash) || !/^[a-f0-9]{64}$/.test(report.binding.scenarioHash) || !/^sha256:[a-f0-9]{64}$/.test(report.binding.inputDigest)) throw new Error("Invalid runtime report binding");
  if (!report.tooling || !keys(report.tooling, ["node", "platform", "architecture"]) || !/^v\d+\.\d+\.\d+$/.test(report.tooling.node) || !label(report.tooling.platform) || !label(report.tooling.architecture)) throw new Error("Invalid runtime tooling identity");
  if (!Number.isFinite(Date.parse(report.createdAt)) || !Number.isFinite(Date.parse(report.expiresAt)) || Date.parse(report.expiresAt) - Date.parse(report.createdAt) !== TTL_MS) throw new Error("Invalid runtime report lifetime");
  for (const item of report.observations) {
    if (!keys(item, ["id", "component", "status", "commands", "artifacts", "facts", "limitations"]) || !label(item.id) || !label(item.component) || !["completed", "failed", "timed-out", "cancelled"].includes(item.status) || !Array.isArray(item.commands) || item.commands.length > 32 || !Array.isArray(item.artifacts) || item.artifacts.length > 32 || !Array.isArray(item.facts) || item.facts.length > 2000 || item.facts.some(fact => !validateRuntimeFact(fact, item.component)) || !Array.isArray(item.limitations) || item.limitations.some(limitation => !RESULT_LIMITATIONS.includes(limitation) && !isRuntimeArtifactLimitation(limitation)) || item.status !== "completed" && (item.facts.length > 0 || item.artifacts.length > 0)) throw new Error("Invalid runtime observation result");
    for (const command of item.commands) if (!keys(command, ["status", "exitCode", "durationMs"]) || !["completed", "failed", "timed-out", "cancelled"].includes(command.status) || !Number.isSafeInteger(command.durationMs) || command.durationMs < 0 || command.exitCode !== null && !Number.isInteger(command.exitCode) || command.status === "completed" && command.exitCode !== 0 || item.status === "completed" && command.status !== "completed") throw new Error("Invalid runtime command result");
    for (const artifact of item.artifacts) if (!keys(artifact, ["path", "format", "digest"]) || typeof artifact.path !== "string" || artifact.path.length > 4096 || artifact.path.startsWith("/") || /[\\:\u0000-\u001f]/.test(artifact.path) || artifact.path.split("/").includes("..") || isSensitiveRepositoryPath(artifact.path) || !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)) throw new Error("Invalid runtime artifact result");
  }
}

/** Read-only, fail-closed validation. Digests detect corruption; they do not authenticate external reports. */
export function readRuntimeObservation(rootInput: string, snapshot: RepositorySnapshot, options: ReadRuntimeObservationOptions = {}): RuntimeObservationReport {
  const root = realpathSync(rootInput), path = reportFile(root), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > REPORT_BYTES) throw new Error("Unsafe runtime report file");
  let report: unknown;
  try { report = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Invalid runtime report JSON"); }
  validateReport(report);
  const age = Date.now() - Date.parse(report.createdAt), maxAge = options.maxAgeMs ?? TTL_MS;
  if (!Number.isSafeInteger(maxAge) || maxAge < 1 || maxAge > 24 * 60 * 60 * 1000 || age < -1000 || age > maxAge || Date.now() > Date.parse(report.expiresAt)) throw new Error("Runtime observation expired or invalid freshness policy");
  if (options.environmentId !== undefined && (!label(options.environmentId) || options.environmentId !== report.environmentId)) throw new Error("Runtime observation environment mismatch");
  assertSnapshotFresh(root, snapshot);
  if (!sameRepositoryPath(report.binding.root, root) || report.binding.snapshotId !== snapshot.snapshotId || report.binding.manifestHash !== snapshot.manifestHash || report.binding.scenarioHash !== snapshot.scenarioHash || report.binding.inputDigest !== inventory(root, snapshot.manifest).digest) throw new Error("Runtime observation source or manifest binding is stale");
  const seen = new Set<string>();
  for (const result of report.observations) {
    const declaration = snapshot.manifest.runtime?.observations.find(item => item.id === result.id);
    if (!declaration || seen.has(result.id) || declaration.component !== result.component || result.commands.length > declaration.commands.length || result.status === "completed" && (result.commands.length !== declaration.commands.length || digest(result.artifacts.map(({ path, format }) => ({ path, format }))) !== digest(declaration.artifacts))) throw new Error("Runtime observation does not match declared execution contract");
    seen.add(result.id);
    for (const artifact of result.artifacts) if (!declaration.artifacts.some(item => item.path === artifact.path && item.format === artifact.format)) throw new Error("Runtime artifact is not declared");
  }
  return report;
}

/** Supplemental observed context; never upgrades static facts to exhaustive observed coverage. */
export function selectRuntimeObservation(report: RuntimeObservationReport, options: { query?: string; scope?: string[]; maxChars?: number } = {}) {
  validateReport(report);
  const maxChars = options.maxChars ?? 4000;
  if (!Number.isSafeInteger(maxChars) || maxChars < 256 || maxChars > 16000) throw new Error("Runtime context maxChars must be 256..16000");
  if (options.query !== undefined && (typeof options.query !== "string" || options.query.length > 8192) || options.scope !== undefined && (!Array.isArray(options.scope) || options.scope.length > 1000 || options.scope.some(item => !label(item)))) throw new Error("Invalid runtime context query or component scope");
  const words = (options.query ?? "").toLowerCase().split(/\W+/).filter(word => word.length > 2).slice(0, 32);
  const candidates = report.observations.filter(item => item.status === "completed" && (!options.scope?.length || options.scope.includes(item.component))).flatMap(item => item.facts.map(fact => ({ observationId: item.id, artifactEvidence: item.artifacts.map(artifact => ({ path: artifact.path, digest: artifact.digest })), ...fact })));
  const score = (fact: typeof candidates[number]) => words.reduce((sum, word) => sum + Number(JSON.stringify(fact).toLowerCase().includes(word)), 0);
  candidates.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
  const context = { reportId: report.reportId, environmentId: report.environmentId, createdAt: report.createdAt, expiresAt: report.expiresAt, assurance: "observed-artifact" as const, completeness: "partial" as const, identitiesAuthenticated: false, facts: [] as typeof candidates, limitations: [...report.limitations, ...new Set(report.observations.flatMap(item => item.limitations))], truncated: false };
  while (JSON.stringify(context).length > maxChars && context.limitations.length) { context.limitations.pop(); context.truncated = true; }
  if (JSON.stringify(context).length > maxChars) throw new Error("Runtime context budget is too small for provenance");
  for (const fact of candidates) { context.facts.push(fact); if (JSON.stringify(context).length > maxChars) { context.facts.pop(); context.truncated = true; break; } }
  return context;
}
