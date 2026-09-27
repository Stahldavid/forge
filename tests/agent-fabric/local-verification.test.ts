import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { sha256Digest } from "../../src/forge/agent-fabric/canonical.ts";
import type { LocalPatchEvidence } from "../../src/forge/agent-fabric/local-coding-worker.ts";
import {
  executeVerificationProcess, preflightLocalDockerVerification, runLocalVerification, type VerificationExecutor, type VerificationProcessInvocation,
  type VerificationProcessResult,
} from "../../src/forge/agent-fabric/local-verification.ts";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const roots: string[] = [];

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function fixture(): { patch: LocalPatchEvidence; root: string } {
  const root = mkdtempSync(join(tmpdir(), "forge-local-verification-"));
  roots.push(root);
  const repo = join(root, "repo");
  const checkout = join(root, "checkout");
  mkdirSync(repo);
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "answer.txt"), "alpha\n");
  writeFileSync(join(repo, "pass.test.mjs"),
    "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('pass', () => assert.equal(1, 1));\n");
  git(repo, ["add", "answer.txt", "pass.test.mjs"]);
  git(repo, ["-c", "user.name=Forge Test", "-c", "user.email=forge@example.test",
    "commit", "-q", "-m", "base"]);
  const baseCommit = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["worktree", "add", "--detach", "--", checkout, baseCommit]);
  writeFileSync(join(checkout, "answer.txt"), "beta\n");
  const worktreeRoot = realpathSync(checkout);
  const diff = execFileSync("git", ["diff", "--binary"], {
    cwd: worktreeRoot, encoding: "utf8", windowsHide: true,
  });
  const diffPath = join(root, "patch.diff");
  writeFileSync(diffPath, diff);
  return {
    root,
    patch: {
      worktreeRoot, baseCommit, changedPaths: ["answer.txt"], diffDigest: sha256Digest(diff),
      diffBytes: Buffer.byteLength(diff), diffPath, verification: "diff_check_passed",
    },
  };
}

afterEach(() => {
  const temp = realpathSync(tmpdir());
  for (const root of roots.splice(0)) {
    const canonical = realpathSync(root);
    if (!canonical.startsWith(`${temp}${sep}`)) throw new Error("Unexpected test cleanup path");
    rmSync(canonical, { recursive: true, force: true });
  }
});

function passed(stdout = ""): VerificationProcessResult {
  return { exitCode: 0, timedOut: false, outputLimitExceeded: false, stdout, stderr: "" };
}

function stubbed(
  calls: VerificationProcessInvocation[],
  runResult: VerificationProcessResult = passed("ok\n"),
  imagePresent = true,
): VerificationExecutor {
  let containerName = "";
  return async (invocation) => {
    calls.push(invocation);
    if (invocation.executable === "git") return passed();
    if (invocation.args[0] === "context") {
      return passed(JSON.stringify("npipe:////./pipe/dockerDesktopLinuxEngine"));
    }
    if (invocation.args.includes("node:22")) {
      return passed(`${IMAGE_ID}|["node@sha256:${"b".repeat(64)}"]\n`);
    }
    if (invocation.args.includes("image")) {
      return imagePresent ? passed(`${IMAGE_ID}\n`) :
        { ...passed(), exitCode: 1, stderr: "image absent" };
    }
    if (invocation.args.includes("create")) {
      containerName = invocation.args[invocation.args.indexOf("--name") + 1]!;
      return passed("container-id\n");
    }
    if (invocation.args.includes("start")) return passed();
    if (invocation.args.includes("stop")) return passed();
    if (invocation.args.includes("inspect") && invocation.args.includes("container")) {
      const identity = invocation.args.find((arg) => arg.startsWith("forge-fabric-verify-"))
        ? containerName : "";
      const source = calls.find((call) => call.args.includes("create"));
      const labels = source?.args ?? [];
      return passed(JSON.stringify({
        Name: `/${identity}`, Image: IMAGE_ID,
        Config: { Image: IMAGE_ID, User: "65534:65534",
          Labels: {
            "dev.forge.fabric.effect": "local_docker_node_test_v1",
            "dev.forge.fabric.verification": labels.find((arg) => arg.startsWith("dev.forge.fabric.verification="))?.split("=")[1],
            "dev.forge.fabric.test": "pass.test.mjs",
          }, Cmd: ["--test", "/workspace/pass.test.mjs"] },
        HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, Privileged: false,
          CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"] },
        Mounts: [{ Destination: "/workspace", RW: false }],
        State: { Status: "exited", ExitCode: runResult.exitCode ?? 0,
          StartedAt: "2026-01-01T00:00:00Z",
          FinishedAt: runResult.timedOut ? "2026-01-01T00:00:30Z" : "2026-01-01T00:00:01Z" },
      }));
    }
    if (invocation.args.includes("logs")) return passed(runResult.stdout);
    if (invocation.args.includes("rm")) return passed();
    throw new Error("Unexpected verification subprocess");
  };
}

function request(patch: LocalPatchEvidence, path = "pass.test.mjs") {
  return {
    patch, imageId: IMAGE_ID,
    commands: [
      { kind: "git-diff-check" as const, timeoutMs: 5_000 },
      { kind: "node-test-file" as const, path, timeoutMs: 20_000 },
    ],
  };
}

test("runs only the approved commands with a pinned offline read-only Docker container", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  const result = await runLocalVerification(request(patch), stubbed(calls));
  expect(result.outcome).toBe("passed");
  expect(result.commands.map((command) => command.outcome)).toEqual(["passed", "passed"]);
  expect(result.commands[1]?.imageId).toBe(IMAGE_ID);
  expect(result.commands[1]?.outputDigest).toBe(sha256Digest(JSON.stringify(["ok\n", ""])));
  const dockerRun = calls.find((call) => call.args.includes("create"));
  expect(dockerRun?.executable).toBe("docker");
  expect(dockerRun?.args).toContain("--pull=never");
  expect(dockerRun?.args).toContain("dev.forge.fabric.effect=local_docker_node_test_v1");
  expect(dockerRun?.args).toContain("--network=none");
  expect(dockerRun?.args).toContain("--read-only");
  expect(dockerRun?.args).toContain("--cap-drop=ALL");
  expect(dockerRun?.args).toContain("--security-opt=no-new-privileges");
  expect(dockerRun?.args).toContain("--pids-limit=64");
  expect(dockerRun?.args).toContain("--memory=512m");
  expect(dockerRun?.args).toContain("--cpus=1");
  expect(dockerRun?.args).toContain("--user=65534:65534");
  expect(dockerRun?.args).toContain(IMAGE_ID);
  expect(dockerRun?.args).toContain("/workspace/pass.test.mjs");
  expect(dockerRun?.args.some((arg) => arg.includes("docker.sock"))).toBe(false);
  expect(dockerRun?.args.some((arg) => arg.startsWith("type=bind,src=") &&
    arg.endsWith(",dst=/workspace,readonly"))).toBe(true);
  expect(calls.every((call) => call.maxOutputBytes === 64 * 1024)).toBe(true);
});

test("host diff verification does not invoke a repository fsmonitor helper", async () => {
  const { root, patch } = fixture();
  const marker = join(root, "fsmonitor-ran");
  const helper = join(root, "fsmonitor-helper");
  writeFileSync(helper, `#!/bin/sh\nprintf invoked > "${marker.replaceAll("\\", "/")}"\n`);
  chmodSync(helper, 0o755);
  git(patch.worktreeRoot, ["config", "core.fsmonitor", helper]);
  const calls: VerificationProcessInvocation[] = [];
  const docker = stubbed(calls);
  const observed = await runLocalVerification(request(patch),
    (invocation) => invocation.executable === "git" ? executeVerificationProcess(invocation) : docker(invocation));
  expect(observed.outcome).toBe("passed");
  expect(existsSync(marker)).toBe(false);
});

test("rejects traversal and missing or unapproved test files before Docker execution", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  await expect(runLocalVerification(request(patch, "../outside.test.mjs"), stubbed(calls)))
    .rejects.toThrow("Verification test path");
  expect(calls.some((call) => call.executable === "docker")).toBe(false);
  await expect(runLocalVerification(request(patch, "missing.test.mjs"), stubbed([])))
    .rejects.toThrow("Verification test path");
  await expect(runLocalVerification({
    ...request(patch),
    commands: [{ kind: "git-diff-check", timeoutMs: 60_001 },
      { kind: "node-test-file", path: "pass.test.mjs", timeoutMs: 5_000 }],
  }, stubbed([]))).rejects.toThrow("timeout");
});

test("fails closed when the exact Docker image is absent", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  const result = await runLocalVerification(request(patch), stubbed(calls, passed(), false));
  expect(result.outcome).toBe("unavailable");
  expect(result.commands.at(-1)?.outcome).toBe("unavailable");
  expect(calls.some((call) => call.args.includes("create"))).toBe(false);
});

test("checks Docker context and both image identities without starting a container", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  await preflightLocalDockerVerification(request(patch), stubbed(calls));
  expect(calls.filter((call) => call.executable === "docker")).toHaveLength(3);
  expect(calls.some((call) => call.args.includes("create"))).toBe(false);
  const unavailable: VerificationExecutor = async (invocation) => {
    calls.push(invocation);
    return { ...passed(), exitCode: null, spawnError: "Docker stopped" };
  };
  await expect(preflightLocalDockerVerification(request(patch), unavailable))
    .rejects.toThrow("context is unavailable");
  expect(calls.some((call) => call.args.includes("run"))).toBe(false);
});

test("commits a dispatch barrier before the first container run", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  let barrier = false;
  const executor = stubbed(calls);
  const guarded: VerificationExecutor = (invocation) => {
    if (invocation.args.includes("create")) expect(barrier).toBe(true);
    return executor(invocation);
  };
  const result = await runLocalVerification(request(patch), guarded, async () => { barrier = true; });
  expect(result.outcome).toBe("passed");
  expect(barrier).toBe(true);
  await expect(runLocalVerification(request(patch), guarded, async () => {
    throw new Error("durable barrier unavailable");
  })).rejects.toThrow("durable barrier unavailable");
});

test("records the named Docker intent before create and its receipt before cleanup", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  const executor = stubbed(calls);
  const identity = sha256Digest("approved verification request");
  let intent = false;
  let receipt = false;
  const guarded: VerificationExecutor = (invocation) => {
    if (invocation.args.includes("create")) expect(intent).toBe(true);
    if (invocation.args.includes("rm")) expect(receipt).toBe(true);
    return executor(invocation);
  };
  const result = await runLocalVerification(request(patch), guarded, {
    identity,
    beforeDockerCreate: async (index, name) => {
      expect(index).toBe(1);
      expect(name).toBe(`forge-fabric-verify-${identity.slice(7, 39)}-1`);
      intent = true;
    },
    receipt: async (index, command) => {
      if (index === 1) {
        expect(intent).toBe(true);
        expect(command.argv).toContain(`forge-fabric-verify-${identity.slice(7, 39)}-1`);
        receipt = true;
      }
    },
  });
  expect(result.outcome).toBe("passed");
  expect(receipt).toBe(true);
  expect(calls.some((call) => call.args.includes("run"))).toBe(false);
});

test("leaves an ambiguous create intent and never starts or cleans the container", async () => {
  const { patch } = fixture();
  const calls: VerificationProcessInvocation[] = [];
  const normal = stubbed(calls);
  const executor: VerificationExecutor = (invocation) => invocation.args.includes("create")
    ? Promise.resolve({ ...passed(), exitCode: null, spawnError: "connection lost" })
    : normal(invocation);
  let intent = false;
  await expect(runLocalVerification(request(patch), executor, {
    identity: sha256Digest("request"),
    beforeDockerCreate: async () => { intent = true; },
    receipt: async () => {},
  })).rejects.toThrow("creation is uncertain");
  expect(intent).toBe(true);
  expect(calls.some((call) => call.args.includes("start") || call.args.includes("rm"))).toBe(false);
});

test("keeps timeout, test failure, and output limit distinct", async () => {
  const { patch } = fixture();
  const timedOut = await runLocalVerification(request(patch), stubbed([], {
    ...passed(), exitCode: null, timedOut: true,
  }));
  expect(timedOut.outcome).toBe("timed_out");
  const failed = await runLocalVerification(request(patch), stubbed([], {
    ...passed(), exitCode: 1, stderr: "test failed",
  }));
  expect(failed.outcome).toBe("failed");
  const outputLimit = await runLocalVerification(request(patch), stubbed([], {
    ...passed("x".repeat(70 * 1024)),
  }));
  expect(outputLimit.outcome).toBe("output_limit");
  expect(outputLimit.commands.at(-1)?.capturedOutputBytes).toBeLessThanOrEqual(64 * 1024);
});

if (process.env.FORGE_FABRIC_DOCKER_SMOKE === "1") {
  test("runs a real Node test in the already installed Docker Desktop image", async () => {
    const { patch } = fixture();
    const imageId = execFileSync(
      "docker", ["--context", "desktop-linux", "image", "inspect", "node:22", "--format", "{{.Id}}"],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const result = await runLocalVerification({
      ...request(patch), imageId,
    });
    expect(result.outcome).toBe("passed");
    expect(result.commands.map((command) => command.outcome)).toEqual(["passed", "passed"]);
  }, 90_000);
}
