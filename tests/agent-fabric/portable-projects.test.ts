import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listFabricProjects, recoverFabricLock, registerFabricProject, resolveFabricProject, resolveFabricRoot } from "../../src/forge/agent-fabric/project-registry.ts";
import { applyFabricProfile, readFabricProfile } from "../../src/forge/agent-fabric/project-profile.ts";
import { ensureFabricOwner, fabricProjectDoctor } from "../../src/forge/agent-fabric/project-runtime.ts";
import { requestManagedRun } from "../../src/forge/agent-fabric/local-task-server.ts";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";

function fixture(parent: string, name: string): string {
  const root = join(parent, name); mkdirSync(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, windowsHide: true });
  git("init", "-q"); git("config", "user.name", "Fabric Test"); git("config", "user.email", "fabric@example.invalid");
  writeFileSync(join(root, "source.txt"), "external\n"); git("add", "source.txt"); git("commit", "-qm", "initial");
  return root;
}

test("registry resolves nested directories, concurrent registrations and immutable ids", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-portable-registry-"));
  try {
    const a = fixture(parent, ".project-a"), b = fixture(parent, "project-b");
    mkdirSync(join(a, "nested")); const options = { registryDirectory: join(parent, "registry") };
    const results = await Promise.all([registerFabricProject(join(a, "nested"), options), registerFabricProject(b, options), registerFabricProject(a, options)]);
    expect(results[0]).toEqual(results[2]); expect((await listFabricProjects(options)).length).toBe(2);
    expect(await resolveFabricProject(results[0]!.id, options)).toBe(await resolveFabricRoot(a));
    await expect(registerFabricProject(b, { ...options, id: results[0]!.id })).rejects.toThrow();
    await expect(resolveFabricProject("missing", options)).rejects.toThrow("not registered");
    await expect(resolveFabricRoot(parent)).rejects.toThrow();
    expect(readFileSync(join(options.registryDirectory, "projects.json"), "utf8")).not.toContain("token");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("optional profile merges defaults without replacing explicit values or executing checks", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-portable-profile-"));
  try {
    const root = fixture(parent, "project"); mkdirSync(join(root, ".forge"));
    writeFileSync(join(root, ".forge", "fabric.json"), JSON.stringify({ schemaVersion: 1, maxConcurrency: 2, environment: { mode: "auto", ignoreScripts: true }, verificationCommands: [["node", "--test"]] }));
    const spec = { workflow: { nodes: [], limits: { maxConcurrency: 1 } }, environment: { mode: "none" } };
    expect(await applyFabricProfile(root, spec)).toMatchObject({ workflow: { limits: { maxConcurrency: 1 } }, environment: { mode: "none", ignoreScripts: true } });
    expect(await applyFabricProfile(root, { workflow: { nodes: [] } })).toMatchObject({ workflow: { limits: { maxConcurrency: 2 } }, environment: { mode: "auto" } });
    expect(spec).toEqual({ workflow: { nodes: [], limits: { maxConcurrency: 1 } }, environment: { mode: "none" } });
    writeFileSync(join(root, ".forge", "fabric.json"), JSON.stringify({ schemaVersion: 1, maxConcurrency: 20 }));
    await expect(readFabricProfile(root)).rejects.toThrow("between 1 and 4");
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("startup recovery preserves live locks and recovers a confirmed exited process", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-portable-lock-"));
  try {
    const lock = join(parent, "owner-start.lock");
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    expect(await recoverFabricLock(lock)).toBe(false);
    expect(readFileSync(lock, "utf8")).toBe(JSON.stringify({ pid: process.pid }));
    const exited = Number(execFileSync("node", ["-p", "process.pid"], { encoding: "utf8", windowsHide: true }));
    writeFileSync(lock, JSON.stringify({ pid: exited }));
    expect(await recoverFabricLock(lock)).toBe(true);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("portable commands parse explicit project registration and owner lifecycle", () => {
  for (const action of ["install-skill", "doctor", "ensure-owner", "project-register", "project-list"]) {
    expect(parseCli(["fabric", action, "--json"]).command).toMatchObject({ kind: "fabric", subcommand: action });
  }
  const args = ["fabric", "project-register", "--project-id", "external", "--json"];
  expect(hasUnknownOption(args)).toBeNull(); expect(parseCli(args).command).toMatchObject({ projectId: "external" });
  expect(parseCli(["fabric", "ensure-owner", "--project-id", "external"]).command).toBeNull();
  expect(parseCli(["fabric", "doctor", "--file", "request.json"]).command).toBeNull();
  expect(parseCli(["fabric", "install-skill", "--dry-run", "--json"]).command).toMatchObject({ dryRun: true });
});

test("invalid owner executable returns a controlled startup failure and releases its lock", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-portable-start-failure-"));
  try {
    const root = fixture(parent, "external");
    await expect(ensureFabricOwner(root, { nodeExecutable: join(parent, "absent-node"), startupTimeoutMs: 3000 })).rejects.toThrow("Agent Fabric");
    await expect(recoverFabricLock(join(root, ".forge", "local", "agent-fabric", "owner-start.lock"))).resolves.toBe(true);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test("external non-Forge repository starts and reuses an owner and executes a real isolated command", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-portable-owner-"));
  let pid: number | undefined;
  try {
    const root = fixture(parent, "external"); mkdirSync(join(root, "nested"));
    const before = await fabricProjectDoctor(root); expect(before.owner.running).toBe(false); expect(before.runtime.sdkAvailable).toBe(true);
    const owner = await ensureFabricOwner(join(root, "nested")); pid = owner.pid;
    expect(owner).toMatchObject({ repositoryRoot: await resolveFabricRoot(root), started: true });
    expect(await ensureFabricOwner(root)).toMatchObject({ pid, started: false });
    const after = await fabricProjectDoctor(root); expect(after.owner.running).toBe(true); expect(after.hooksRequired).toBe(false);
    const view = await requestManagedRun(root, "run-start", { requestId: "external-command", goal: "Verify portable execution", scope: ["source.txt"], publish: false, environment: { mode: "none" },
      workflow: { workflowId: "external", nodes: [{ nodeId: "check", kind: "verification", dependsOn: [], inputDigest: `sha256:${"a".repeat(64)}`, required: true }] },
      executors: [{ nodeId: "check", type: "command", argv: ["node", "-e", 'process.stdout.write(require("node:fs").readFileSync("source.txt", "utf8"))'], timeoutMs: 5000 }] }) as { runId: string; cursor: number; status: string };
    let current = view; const deadline = Date.now() + 15000;
    while (!["completed", "failed", "blocked"].includes(current.status) && Date.now() < deadline) current = (await requestManagedRun(root, "run-wait", { runId: current.runId, cursor: current.cursor, waitMs: 500 }) as { run: typeof view }).run;
    expect(current.status).toBe("completed");
    expect(readFileSync(join(root, "source.txt"), "utf8")).toBe("external\n");
  } finally {
    if (pid) { process.kill(pid); for (let i = 0; i < 50; i++) { try { process.kill(pid, 0); await new Promise(resolve => setTimeout(resolve, 100)); } catch { break; } } }
    rmSync(parent, { recursive: true, force: true });
  }
}, 60000);
