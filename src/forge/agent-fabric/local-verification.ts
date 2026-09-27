import { execFileSync, spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { digestCanonical, sha256Digest } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { verifyLocalPatchEvidence, type LocalPatchEvidence } from "./local-coding-worker.ts";
import type { Digest } from "./types.ts";

const DOCKER_CONTEXT = "desktop-linux";
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_COMMANDS = 4;
const MAX_TIMEOUT_MS = 60_000;
const DOCKER_CONTROL_TIMEOUT_MS = 10_000;

export type LocalVerificationCommand =
  | { kind: "git-diff-check"; timeoutMs: number }
  | { kind: "node-test-file"; path: string; timeoutMs: number };

export interface LocalVerificationRequest {
  patch: LocalPatchEvidence;
  /** Trusted, owner-approved descriptors. Never derive these from model text. */
  commands: readonly LocalVerificationCommand[];
  /** Immutable ID of a Node image already present in Docker Desktop. */
  imageId: string;
}

export interface VerificationProcessInvocation {
  executable: "git" | "docker";
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface VerificationProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  outputLimitExceeded: boolean;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

export type VerificationExecutor = (
  invocation: VerificationProcessInvocation,
) => Promise<VerificationProcessResult>;

export type LocalVerificationOutcome =
  | "passed" | "failed" | "timed_out" | "output_limit" | "unavailable";

export interface LocalVerificationCommandEvidence {
  descriptor: LocalVerificationCommand;
  runtime: "host-git" | "docker-node";
  /** The exact command arguments passed to the trusted executor. */
  argv: readonly string[];
  imageId: string | null;
  outcome: LocalVerificationOutcome;
  exitCode: number | null;
  outputDigest: Digest;
  capturedOutputBytes: number;
  outputPreview: string;
  durationMs: number;
}

export interface LocalVerificationEvidence {
  patchDigest: Digest;
  imageId: string;
  outcome: LocalVerificationOutcome;
  commands: readonly LocalVerificationCommandEvidence[];
}

/** A callback must commit its receipt before the Docker container is removed. */
export interface LocalVerificationHooks {
  identity: Digest;
  beforeDockerCreate(index: number, containerName: string,
    descriptor: Extract<LocalVerificationCommand, { kind: "node-test-file" }>): Promise<void>;
  receipt(index: number, command: LocalVerificationCommandEvidence): Promise<void>;
}

export function localVerificationContainerName(identity: Digest, index: number): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(identity) || !Number.isSafeInteger(index) || index < 1 || index > 3) {
    invalid("Invalid verification container identity");
  }
  return `forge-fabric-verify-${identity.slice(7, 39)}-${index}`;
}

/** Run a command without a shell and stop reading once the output budget is exhausted. */
export const executeVerificationProcess: VerificationExecutor = (invocation) => new Promise((resolveResult) => {
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let captured = 0;
  let timedOut = false;
  let outputLimitExceeded = false;
  let spawnError: string | undefined;
  let settled = false;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(invocation.executable, [...invocation.args], {
      cwd: invocation.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    resolveResult({
      exitCode: null, timedOut: false, outputLimitExceeded: false,
      stdout: "", stderr: "", spawnError: String(error),
    });
    return;
  }
  const finish = (code: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
    resolveResult({
      exitCode: code, timedOut, outputLimitExceeded,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
      ...(spawnError ? { spawnError } : {}),
    });
  };
  const stop = () => {
    child.kill();
    hardTimer ??= setTimeout(() => finish(null), 2_000);
  };
  const capture = (chunk: Buffer, target: Buffer[]) => {
    const remaining = invocation.maxOutputBytes - captured;
    if (remaining > 0) {
      const part = chunk.subarray(0, remaining);
      target.push(part);
      captured += part.length;
    }
    if (chunk.length > remaining && !outputLimitExceeded) {
      outputLimitExceeded = true;
      stop();
    }
  };
  child.stdout?.on("data", (chunk: Buffer) => capture(chunk, stdout));
  child.stderr?.on("data", (chunk: Buffer) => capture(chunk, stderr));
  child.on("error", (error) => { spawnError = String(error); });
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, invocation.timeoutMs);
  child.on("close", finish);
});

function invalid(message: string): never {
  throw new AgentFabricError("AF_INVALID_STATE", message);
}

function validateRequest(request: LocalVerificationRequest): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(request.imageId)) invalid("Verification image ID must be immutable");
  if (!Array.isArray(request.commands) || request.commands.length < 2 ||
      request.commands.length > MAX_COMMANDS ||
      request.commands[0]?.kind !== "git-diff-check" ||
      request.commands.slice(1).some((command) => command.kind !== "node-test-file")) {
    invalid("Verification requires git diff --check followed by one to three Node test files");
  }
  const paths = new Set<string>();
  for (const command of request.commands) {
    if (!command || typeof command !== "object" ||
        (command.kind !== "git-diff-check" && command.kind !== "node-test-file") ||
        Object.keys(command).sort().join(",") !==
          (command.kind === "git-diff-check" ? "kind,timeoutMs" : "kind,path,timeoutMs")) {
      invalid("Verification command descriptor is not exact");
    }
    if (!Number.isSafeInteger(command.timeoutMs) ||
        command.timeoutMs < 1 || command.timeoutMs > MAX_TIMEOUT_MS) {
      invalid("Verification command timeout exceeds its bounded allowance");
    }
    if (command.kind === "node-test-file") {
      if (typeof command.path !== "string") invalid("Verification test path is invalid");
      if (paths.has(command.path.toLowerCase())) invalid("Duplicate verification test file");
      paths.add(command.path.toLowerCase());
    }
  }
}

function parseTrustedNodeImage(stdout: string): string | null {
  const separator = stdout.indexOf("|");
  if (separator < 0) return null;
  const imageId = stdout.slice(0, separator).trim();
  let repoDigests: unknown;
  try { repoDigests = JSON.parse(stdout.slice(separator + 1).trim()); }
  catch { return null; }
  if (!/^sha256:[0-9a-f]{64}$/u.test(imageId) || !Array.isArray(repoDigests) ||
      !repoDigests.some((digest) => typeof digest === "string" &&
        /^node@sha256:[0-9a-f]{64}$/u.test(digest))) return null;
  return imageId;
}

/** Resolve the owner machine's official Node image tag, never an arbitrary proposal image. */
export function trustedLocalNodeImageId(): string {
  try {
    const output = execFileSync("docker", ["--context", DOCKER_CONTEXT,
      "image", "inspect", "node:22", "--format", "{{.Id}}|{{json .RepoDigests}}"],
    { encoding: "utf8", windowsHide: true, timeout: DOCKER_CONTROL_TIMEOUT_MS,
      maxBuffer: 16 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    const imageId = parseTrustedNodeImage(output);
    if (imageId) return imageId;
  } catch { /* fail closed below */ }
  return invalid("Trusted local node:22 image with registry digest is unavailable");
}

function checkedTestPath(worktreeRoot: string, path: string): string {
  if (typeof path !== "string" || path.length < 1 || path.length > 240 ||
      isAbsolute(path) || path.includes("\\") || path.includes(":") ||
      /[\u0000-\u001f\u007f]/u.test(path) || path.normalize("NFC") !== path) {
    invalid("Invalid verification test path");
  }
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." ||
      [".git", ".forge", "node_modules"].includes(segment.toLowerCase()))) {
    invalid("Verification test path escapes the approved checkout");
  }
  const target = resolve(worktreeRoot, ...segments);
  const prefix = worktreeRoot.endsWith(sep) ? worktreeRoot : `${worktreeRoot}${sep}`;
  const normalizedTarget = process.platform === "win32" ? target.toLowerCase() : target;
  const normalizedPrefix = process.platform === "win32" ? prefix.toLowerCase() : prefix;
  if (!normalizedTarget.startsWith(normalizedPrefix)) invalid("Verification test path escapes the checkout");
  let cursor = worktreeRoot;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor) || lstatSync(cursor).isSymbolicLink()) {
      invalid("Verification test path is missing or traverses a symbolic link");
    }
  }
  if (!lstatSync(target).isFile() || realpathSync(target) !== target) {
    invalid("Verification test target is not a regular checkout file");
  }
  return target;
}

/** Check deterministic paths and mount encoding before recording a dispatch intent. */
export function preflightLocalVerification(request: LocalVerificationRequest): void {
  validateRequest(request);
  verifyLocalPatchEvidence(request.patch);
  const worktreeRoot = realpathSync(request.patch.worktreeRoot);
  if (worktreeRoot.includes(",") || /[\r\n]/u.test(worktreeRoot)) {
    invalid("Checkout path cannot be represented as a Docker bind mount");
  }
  for (const descriptor of request.commands) {
    if (descriptor.kind === "node-test-file") checkedTestPath(worktreeRoot, descriptor.path);
  }
}

/** Read-only Docker availability and exact image checks before consuming an intent. */
export async function preflightLocalDockerVerification(
  request: LocalVerificationRequest,
  executor: VerificationExecutor = executeVerificationProcess,
): Promise<void> {
  preflightLocalVerification(request);
  const cwd = realpathSync(request.patch.worktreeRoot);
  const context = await run(executor, "docker", [
    "context", "inspect", DOCKER_CONTEXT, "--format", "{{json .Endpoints.docker.Host}}",
  ], cwd, DOCKER_CONTROL_TIMEOUT_MS);
  let endpoint: unknown;
  try { endpoint = JSON.parse(context.result.stdout.trim()); } catch { /* fail closed below */ }
  if (failedControl(context.result) || endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine") {
    invalid("Local Docker Desktop context is unavailable");
  }
  const tagged = await run(executor, "docker", [
    "--context", DOCKER_CONTEXT, "image", "inspect", "node:22",
    "--format", "{{.Id}}|{{json .RepoDigests}}",
  ], cwd, DOCKER_CONTROL_TIMEOUT_MS);
  if (failedControl(tagged.result) || parseTrustedNodeImage(tagged.result.stdout) !== request.imageId) {
    invalid("Approved image is not the trusted local node:22 image");
  }
  const inspect = await run(executor, "docker", [
    "--context", DOCKER_CONTEXT, "image", "inspect", request.imageId,
    "--format", "{{.Id}}",
  ], cwd, DOCKER_CONTROL_TIMEOUT_MS);
  if (failedControl(inspect.result) || inspect.result.stdout.trim() !== request.imageId) {
    invalid("Approved Docker image is unavailable");
  }
}

function bounded(result: VerificationProcessResult): VerificationProcessResult {
  const combined = Buffer.byteLength(result.stdout, "utf8") + Buffer.byteLength(result.stderr, "utf8");
  if (combined <= MAX_OUTPUT_BYTES) return result;
  const stdout = Buffer.from(result.stdout, "utf8").subarray(0, MAX_OUTPUT_BYTES);
  const remaining = MAX_OUTPUT_BYTES - stdout.length;
  const stderr = Buffer.from(result.stderr, "utf8").subarray(0, remaining);
  return {
    ...result,
    stdout: stdout.toString("utf8"),
    stderr: stderr.toString("utf8"),
    outputLimitExceeded: true,
  };
}

function outcomeOf(result: VerificationProcessResult): LocalVerificationOutcome {
  if (result.timedOut) return "timed_out";
  if (result.outputLimitExceeded) return "output_limit";
  if (result.spawnError) return "unavailable";
  return result.exitCode === 0 ? "passed" : "failed";
}

function evidence(
  descriptor: LocalVerificationCommand,
  runtime: LocalVerificationCommandEvidence["runtime"],
  argv: readonly string[],
  imageId: string | null,
  rawResult: VerificationProcessResult,
  durationMs: number,
): LocalVerificationCommandEvidence {
  const result = bounded(rawResult);
  const capturedOutputBytes = Buffer.byteLength(result.stdout, "utf8") +
    Buffer.byteLength(result.stderr, "utf8");
  return {
    descriptor, runtime, argv, imageId, outcome: outcomeOf(result),
    exitCode: result.exitCode,
    outputDigest: sha256Digest(JSON.stringify([result.stdout, result.stderr])),
    capturedOutputBytes,
    outputPreview: `${result.stdout}\n${result.stderr}`.slice(0, 1024),
    durationMs,
  };
}

async function run(
  executor: VerificationExecutor,
  executable: VerificationProcessInvocation["executable"],
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
): Promise<{ result: VerificationProcessResult; durationMs: number }> {
  const start = Date.now();
  try {
    const result = await executor({
      executable, args, cwd, timeoutMs, maxOutputBytes: MAX_OUTPUT_BYTES,
    });
    return { result: bounded(result), durationMs: Date.now() - start };
  } catch (error) {
    return {
      result: {
        exitCode: null, timedOut: false, outputLimitExceeded: false,
        stdout: "", stderr: "", spawnError: String(error),
      },
      durationMs: Date.now() - start,
    };
  }
}

function failedControl(result: VerificationProcessResult): boolean {
  return outcomeOf(result) !== "passed";
}

function dockerCreateArgs(request: LocalVerificationRequest, worktreeRoot: string,
  descriptor: Extract<LocalVerificationCommand, { kind: "node-test-file" }>,
  identity: Digest, name: string): string[] {
  return [
    "--context", DOCKER_CONTEXT, "create", "--pull=never", "--name", name,
    "--label", "dev.forge.fabric.effect=local_docker_node_test_v1",
    "--label", `dev.forge.fabric.verification=${identity}`,
    "--label", `dev.forge.fabric.test=${descriptor.path}`,
    "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=512m",
    "--memory-swap=512m", "--cpus=1", "--user=65534:65534",
    "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
    "--mount", `type=bind,src=${worktreeRoot},dst=/workspace,readonly`,
    "--workdir=/workspace", "--entrypoint=node", request.imageId,
    "--test", `/workspace/${descriptor.path}`,
  ];
}

/** Inspect an existing named container only. Missing or running containers stay unresolved. */
export async function readbackLocalDockerVerification(
  request: LocalVerificationRequest, identity: Digest, index: number,
  executor: VerificationExecutor = executeVerificationProcess,
): Promise<LocalVerificationCommandEvidence | null> {
  preflightLocalVerification(request);
  const descriptor = request.commands[index];
  if (!descriptor || descriptor.kind !== "node-test-file") invalid("Invalid Docker verification command index");
  const worktreeRoot = realpathSync(request.patch.worktreeRoot);
  const name = localVerificationContainerName(identity, index);
  const inspected = await run(executor, "docker", [
    "--context", DOCKER_CONTEXT, "inspect", "--type", "container", name,
    "--format", "{{json .}}",
  ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
  if (failedControl(inspected.result)) return null;
  let container: any;
  try { container = JSON.parse(inspected.result.stdout); }
  catch { invalid("Docker verification inspect returned invalid JSON"); }
  const configuredMounts = container?.HostConfig?.Mounts;
  const actualMounts = container?.Mounts;
  if (container?.Name !== `/${name}` || container?.Image !== request.imageId ||
      container?.Config?.Image !== request.imageId ||
      JSON.stringify(container?.Config?.Entrypoint) !== JSON.stringify(["node"]) ||
      container?.Config?.WorkingDir !== "/workspace" ||
      container?.Config?.Labels?.["dev.forge.fabric.effect"] !== "local_docker_node_test_v1" ||
      container?.Config?.Labels?.["dev.forge.fabric.verification"] !== identity ||
      container?.Config?.Labels?.["dev.forge.fabric.test"] !== descriptor.path ||
      JSON.stringify(container?.Config?.Cmd) !== JSON.stringify(["--test", `/workspace/${descriptor.path}`]) ||
      container?.Config?.User !== "65534:65534" ||
      container?.HostConfig?.NetworkMode !== "none" ||
      container?.HostConfig?.ReadonlyRootfs !== true ||
      container?.HostConfig?.Privileged !== false ||
      !container?.HostConfig?.CapDrop?.includes("ALL") ||
      !container?.HostConfig?.SecurityOpt?.includes("no-new-privileges") ||
      container?.HostConfig?.PidsLimit !== 64 ||
      container?.HostConfig?.Memory !== 536_870_912 ||
      container?.HostConfig?.MemorySwap !== 536_870_912 ||
      container?.HostConfig?.NanoCpus !== 1_000_000_000 ||
      container?.HostConfig?.Tmpfs?.["/tmp"] !== "rw,noexec,nosuid,nodev,size=64m" ||
      !Array.isArray(configuredMounts) || configuredMounts.length !== 1 ||
      configuredMounts[0]?.Type !== "bind" || configuredMounts[0]?.Source !== worktreeRoot ||
      configuredMounts[0]?.Target !== "/workspace" || configuredMounts[0]?.ReadOnly !== true ||
      !Array.isArray(actualMounts) || actualMounts.length !== 1 ||
      actualMounts[0]?.Type !== "bind" || actualMounts[0]?.Source !== worktreeRoot ||
      actualMounts[0]?.Destination !== "/workspace" || actualMounts[0]?.RW !== false) {
    invalid("Docker verification container identity does not match its durable intent");
  }
  if (container.State?.Status !== "exited" || !Number.isSafeInteger(container.State.ExitCode)) return null;
  const logs = await run(executor, "docker", [
    "--context", DOCKER_CONTEXT, "logs", name,
  ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
  if (logs.result.spawnError || logs.result.timedOut || logs.result.exitCode !== 0) return null;
  const started = Date.parse(container.State.StartedAt);
  const finished = Date.parse(container.State.FinishedAt);
  const durationMs = Number.isFinite(started) && Number.isFinite(finished) && finished >= started
    ? finished - started : 0;
  const result = { ...logs.result, exitCode: container.State.ExitCode,
    timedOut: durationMs > descriptor.timeoutMs };
  return evidence(descriptor, "docker-node",
    ["docker", ...dockerCreateArgs(request, worktreeRoot, descriptor, identity, name)],
    request.imageId, result, durationMs);
}

/** A cleanup failure leaves a receipted container for a later maintenance pass. */
export async function cleanupReceiptedLocalDockerVerification(
  request: LocalVerificationRequest, identity: Digest, index: number,
  executor: VerificationExecutor = executeVerificationProcess,
): Promise<boolean> {
  const cwd = realpathSync(request.patch.worktreeRoot);
  const name = localVerificationContainerName(identity, index);
  const removed = await run(executor, "docker", [
    "--context", DOCKER_CONTEXT, "rm", name,
  ], cwd, DOCKER_CONTROL_TIMEOUT_MS);
  return !failedControl(removed.result);
}

/**
 * Verify an approved patch without executing repository code on the host.
 * The Node test runner can read the isolated checkout, but cannot modify it or use the network.
 */
export async function runLocalVerification(
  request: LocalVerificationRequest,
  executor: VerificationExecutor = executeVerificationProcess,
  callbacks?: LocalVerificationHooks | (() => Promise<void>),
  completedCommands: readonly LocalVerificationCommandEvidence[] = [],
): Promise<LocalVerificationEvidence> {
  preflightLocalVerification(request);
  if (completedCommands.length > request.commands.length || completedCommands.some((command, index) =>
    command.outcome !== "passed" ||
    digestCanonical(command.descriptor, sha256Digest) !== digestCanonical(request.commands[index], sha256Digest) ||
    command.runtime !== (index === 0 ? "host-git" : "docker-node") ||
    (index > 0 && command.imageId !== request.imageId))) {
    invalid("Verification continuation is not a passed prefix of the approved commands");
  }
  const worktreeRoot = realpathSync(request.patch.worktreeRoot);
  const results: LocalVerificationCommandEvidence[] = [...completedCommands];
  const hooks = typeof callbacks === "function" ? undefined : callbacks;
  const identity = hooks?.identity ?? sha256Digest(JSON.stringify([
    request.patch.diffDigest, request.imageId, request.commands,
  ]));
  let imageChecked = false;
  for (const [index, descriptor] of request.commands.entries()) {
    if (index < completedCommands.length) continue;
    verifyLocalPatchEvidence(request.patch);
    if (descriptor.kind === "git-diff-check") {
      const args = ["--no-pager", "-c", "core.fsmonitor=false", "-c", "diff.external=", "diff",
        "--no-ext-diff", "--no-textconv", "--check"];
      const { result, durationMs } = await run(executor, "git", args, worktreeRoot, descriptor.timeoutMs);
      const command = evidence(descriptor, "host-git", ["git", ...args], null, result, durationMs);
      await hooks?.receipt(index, command);
      results.push(command);
    } else {
      checkedTestPath(worktreeRoot, descriptor.path);
      if (!imageChecked) {
        const context = await run(executor, "docker", [
          "context", "inspect", DOCKER_CONTEXT, "--format", "{{json .Endpoints.docker.Host}}",
        ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
        let endpoint: unknown;
        try { endpoint = JSON.parse(context.result.stdout.trim()); } catch { /* fail closed below */ }
        if (failedControl(context.result) ||
            endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine") {
          results.push(evidence(descriptor, "docker-node", ["docker", "context", "inspect", DOCKER_CONTEXT],
            request.imageId, { ...context.result, exitCode: null,
              spawnError: "Local Docker Desktop context is unavailable" }, context.durationMs));
          break;
        }
        const tagged = await run(executor, "docker", [
          "--context", DOCKER_CONTEXT, "image", "inspect", "node:22",
          "--format", "{{.Id}}|{{json .RepoDigests}}",
        ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
        if (failedControl(tagged.result) || parseTrustedNodeImage(tagged.result.stdout) !== request.imageId) {
          results.push(evidence(descriptor, "docker-node",
            ["docker", "--context", DOCKER_CONTEXT, "image", "inspect", "node:22"],
            request.imageId, { ...tagged.result, exitCode: null,
              spawnError: "Approved image is not the trusted local node:22 image" }, tagged.durationMs));
          break;
        }
        const inspect = await run(executor, "docker", [
          "--context", DOCKER_CONTEXT, "image", "inspect", request.imageId,
          "--format", "{{.Id}}",
        ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
        if (failedControl(inspect.result) || inspect.result.stdout.trim() !== request.imageId) {
          results.push(evidence(descriptor, "docker-node",
            ["docker", "--context", DOCKER_CONTEXT, "image", "inspect", request.imageId],
            request.imageId, { ...inspect.result, exitCode: null,
              spawnError: "Approved Docker image is unavailable" }, inspect.durationMs));
          break;
        }
        imageChecked = true;
      }
      const name = localVerificationContainerName(identity, index);
      const args = dockerCreateArgs(request, worktreeRoot, descriptor, identity, name);
      if (worktreeRoot.includes(",") || /[\r\n]/u.test(worktreeRoot)) {
        invalid("Checkout path cannot be represented as a Docker bind mount");
      }
      if (typeof callbacks === "function") await callbacks();
      await hooks?.beforeDockerCreate(index, name, descriptor);
      const created = await run(executor, "docker", args, worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
      if (failedControl(created.result)) {
        invalid("Docker container creation is uncertain; reconcile the named container before retrying");
      }
      const started = await run(executor, "docker", [
        "--context", DOCKER_CONTEXT, "start", "--attach", name,
      ], worktreeRoot, descriptor.timeoutMs);
      if (started.result.timedOut || started.result.outputLimitExceeded) {
        await run(executor, "docker", [
          "--context", DOCKER_CONTEXT, "stop", "--time", "1", name,
        ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
      }
      const command = await readbackLocalDockerVerification(request, identity, index, executor);
      if (!command) invalid("Docker container outcome is unresolved; reconcile the named container");
      await hooks?.receipt(index, command);
      results.push(command);
      // The container remains inspectable until its receipt commits.
      await cleanupReceiptedLocalDockerVerification(request, identity, index, executor);
    }
    verifyLocalPatchEvidence(request.patch);
    if (results.at(-1)?.outcome !== "passed") break;
  }
  const outcome = results.at(-1)?.outcome ?? "unavailable";
  return { patchDigest: request.patch.diffDigest, imageId: request.imageId,
    outcome, commands: results };
}
