import { spawn } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, sep } from "node:path";
import { sha256Digest } from "./canonical.ts";
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

/**
 * Verify an approved patch without executing repository code on the host.
 * The Node test runner can read the isolated checkout, but cannot modify it or use the network.
 */
export async function runLocalVerification(
  request: LocalVerificationRequest,
  executor: VerificationExecutor = executeVerificationProcess,
): Promise<LocalVerificationEvidence> {
  validateRequest(request);
  verifyLocalPatchEvidence(request.patch);
  const worktreeRoot = realpathSync(request.patch.worktreeRoot);
  const results: LocalVerificationCommandEvidence[] = [];
  let imageChecked = false;
  for (const descriptor of request.commands) {
    verifyLocalPatchEvidence(request.patch);
    if (descriptor.kind === "git-diff-check") {
      const args = ["--no-pager", "-c", "diff.external=", "diff",
        "--no-ext-diff", "--no-textconv", "--check"];
      const { result, durationMs } = await run(executor, "git", args, worktreeRoot, descriptor.timeoutMs);
      results.push(evidence(descriptor, "host-git", ["git", ...args], null, result, durationMs));
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
      const name = `forge-fabric-verify-${randomUUID()}`;
      const args = [
        "--context", DOCKER_CONTEXT, "run", "--rm", "--pull=never", "--name", name,
        "--network=none", "--read-only", "--cap-drop=ALL",
        "--security-opt=no-new-privileges", "--pids-limit=64", "--memory=512m",
        "--memory-swap=512m", "--cpus=1", "--user=65534:65534",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m",
        "--mount", `type=bind,src=${worktreeRoot},dst=/workspace,readonly`,
        "--workdir=/workspace", "--entrypoint=node", request.imageId,
        "--test", `/workspace/${descriptor.path}`,
      ];
      if (worktreeRoot.includes(",") || /[\r\n]/u.test(worktreeRoot)) {
        invalid("Checkout path cannot be represented as a Docker bind mount");
      }
      const { result, durationMs } = await run(executor, "docker", args, worktreeRoot, descriptor.timeoutMs);
      let finalResult = result;
      if (result.timedOut || result.outputLimitExceeded || result.spawnError) {
        const cleanup = await run(executor, "docker", [
          "--context", DOCKER_CONTEXT, "rm", "--force", name,
        ], worktreeRoot, DOCKER_CONTROL_TIMEOUT_MS);
        if (failedControl(cleanup.result)) {
          finalResult = { ...result, timedOut: false, outputLimitExceeded: false,
            spawnError: "Container cleanup could not be confirmed" };
        }
      }
      results.push(evidence(descriptor, "docker-node", ["docker", ...args],
        request.imageId, finalResult, durationMs));
    }
    verifyLocalPatchEvidence(request.patch);
    if (results.at(-1)?.outcome !== "passed") break;
  }
  const outcome = results.at(-1)?.outcome ?? "unavailable";
  return { patchDigest: request.patch.diffDigest, imageId: request.imageId,
    outcome, commands: results };
}
