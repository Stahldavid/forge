import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LocalCodingTaskProposal } from "../../src/forge/agent-fabric/local-task-contract.ts";
import { LocalTaskService } from "../../src/forge/agent-fabric/local-task-service.ts";
import { buildLocalCodingContext, materializeLocalCodingPatch } from "../../src/forge/agent-fabric/local-coding-worker.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

describe("local task service", () => {
  test("one proposal cannot open two simultaneous owner decisions", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-fabric-review-race-"));
    try {
      git(root, "init", "-q");
      git(root, "config", "user.name", "Forge Test");
      git(root, "config", "user.email", "forge-test@example.invalid");
      writeFileSync(join(root, "source.txt"), "original\n");
      git(root, "add", "source.txt");
      git(root, "commit", "-qm", "fixture");
      let decide!: (value: "approved" | "rejected") => void;
      let windowCount = 0;
      const service = await LocalTaskService.open(root, async () => {
        windowCount += 1;
        return new Promise((resolve) => { decide = resolve; });
      });
      try {
        const proposed = await service.propose({
          schemaVersion: 1, repositoryId: "repo:fixture", baseCommit: git(root, "rev-parse", "HEAD"),
          goal: "Edit the fixture", acceptanceCriteria: ["Change source.txt"], nonObjectives: [],
          sourcePaths: ["source.txt"], writablePaths: ["source.txt"],
          requestedModelTargetId: "target:ollama:local",
          limits: { maximumAttempts: 1, maximumWallClockMs: 60_000, maximumOutputTokens: 256,
            maximumContextBytes: 4_096, maximumPatchBytes: 4_096, expiresAt: Date.now() + 120_000 },
        });
        const first = service.review(proposed.taskId);
        await expect(service.review(proposed.taskId)).rejects.toThrow("active owner review");
        while (windowCount === 0) await new Promise((resolve) => setTimeout(resolve, 5));
        decide("rejected");
        expect((await first).state).toBe("rejected");
        expect(windowCount).toBe(1);
      } finally { await service.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test("validates before persistence, binds approval, and replays after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-fabric-service-"));
    try {
      git(root, "init", "-q");
      git(root, "config", "user.name", "Forge Test");
      git(root, "config", "user.email", "forge-test@example.invalid");
      writeFileSync(join(root, "source.txt"), "original\n");
      git(root, "add", "source.txt");
      git(root, "commit", "-qm", "fixture");
      const baseCommit = git(root, "rev-parse", "HEAD");
      const proposal: LocalCodingTaskProposal = {
        schemaVersion: 1, repositoryId: "repo:fixture", baseCommit,
        goal: "Edit the fixture", acceptanceCriteria: ["Change source.txt"],
        nonObjectives: [], sourcePaths: ["source.txt"], writablePaths: ["source.txt"],
        requestedModelTargetId: "target:ollama:local",
        limits: { maximumAttempts: 1, maximumWallClockMs: 60_000,
          maximumOutputTokens: 256, maximumContextBytes: 4_096,
          maximumPatchBytes: 4_096, expiresAt: Date.now() + 120_000 },
      };
      let signalModelStarted!: () => void;
      let releaseModel!: () => void;
      const modelStarted = new Promise<void>((resolve) => { signalModelStarted = resolve; });
      const modelRelease = new Promise<void>((resolve) => { releaseModel = resolve; });
      const service = await LocalTaskService.open(root, async () => "approved", async () => {
        signalModelStarted();
        await modelRelease;
        return { text: JSON.stringify({ schemaVersion: 1, files: [{ path: "source.txt", content: "changed\n" }] }) };
      });
      try {
        await expect(service.propose({ ...proposal, baseCommit: "f".repeat(40) })).rejects.toThrow();
        await expect(service.propose({ ...proposal, sourcePaths: [".env.local"] })).rejects.toThrow();
        const proposed = await service.propose(proposal);
        expect(proposed.state).toBe("proposed");
        const approved = await service.review(proposed.taskId);
        expect(approved.state).toBe("owner_approved");
        await expect(service.review(proposed.taskId)).rejects.toThrow();
        writeFileSync(join(root, "source.txt"), "changed outside approved snapshot\n");
        await expect(service.run(proposed.taskId)).rejects.toThrow("changed in the working tree");
        expect((await service.status(proposed.taskId)).state).toBe("owner_approved");
        writeFileSync(join(root, "source.txt"), "original\n");
        const running = service.run(proposed.taskId);
        await modelStarted;
        const inFlight = await service.status(proposed.taskId);
        expect(inFlight.state).toBe("model_uncertain");
        releaseModel();
        const completed = await running;
        expect(completed.state).toBe("patch_ready");
        expect(completed.patch?.changedPaths).toEqual(["source.txt"]);
        const evidence = await service.evidence(proposed.taskId);
        expect(evidence.provenance?.outcome?.status).toBe("succeeded");
        expect(evidence.provenance?.patch?.diffDigest).toBe(completed.patch?.diffDigest);
        expect(evidence.provenance?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
        await expect(service.run(proposed.taskId)).rejects.toThrow();
      } finally {
        await service.close();
      }
      const reopened = await LocalTaskService.open(root, async () => "rejected", undefined, async () => "approved");
      try {
        const status = await reopened.propose(proposal);
        expect(status.state).toBe("patch_ready");
        expect((await reopened.evidence(status.taskId)).provenance?.patch?.diffDigest).toBe(status.patch?.diffDigest);
        const extra = join(status.patch!.worktreeRoot, "extra.txt");
        writeFileSync(extra, "unreviewed\n");
        await expect(reopened.reviewResult(status.taskId)).rejects.toThrow("unrecorded");
        rmSync(extra);
        const accepted = await reopened.reviewResult(status.taskId);
        expect(accepted.state).toBe("accepted");
        await expect(reopened.reviewResult(status.taskId)).rejects.toThrow();
      } finally {
        await reopened.close();
      }
      expect(buildLocalCodingContext(root, proposal)).toContain("original");
      expect(() => materializeLocalCodingPatch(root, "task:" + "a".repeat(64), proposal,
        JSON.stringify({ schemaVersion: 1, files: [{ path: "other.txt", content: "bad" }] }))).toThrow();
      const patch = materializeLocalCodingPatch(root, "task:" + "a".repeat(64), proposal,
        JSON.stringify({ schemaVersion: 1, files: [{ path: "source.txt", content: "changed\n" }] }));
      expect(patch.changedPaths).toEqual(["source.txt"]);
      expect(patch.diffBytes).toBeGreaterThan(0);
      const fenced = materializeLocalCodingPatch(root, "task:" + "b".repeat(64), proposal,
        "```json\n[{\"path\":\"source.txt\",\"content\":\"changed\\n\"}]\n```");
      expect(fenced.changedPaths).toEqual(["source.txt"]);
      const mapped = materializeLocalCodingPatch(root, "task:" + "c".repeat(64), proposal,
        "{\"source.txt\":\"changed\\n\"}");
      expect(mapped.changedPaths).toEqual(["source.txt"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

if (process.env.FORGE_FABRIC_DOCKER_SMOKE === "1") {
  test("owner-approved verification survives restart and gates diff acceptance", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-fabric-verified-task-"));
    try {
      git(root, "init", "-q");
      git(root, "config", "user.name", "Forge Test");
      git(root, "config", "user.email", "forge-test@example.invalid");
      writeFileSync(join(root, "answer.txt"), "alpha\n");
      writeFileSync(join(root, "pass.test.mjs"),
        "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('answer', () => assert.equal(1, 1));\n");
      git(root, "add", "answer.txt", "pass.test.mjs");
      git(root, "commit", "-qm", "fixture");
      const imageId = execFileSync("docker", ["--context", "desktop-linux", "image", "inspect", "node:22", "--format", "{{.Id}}"],
        { encoding: "utf8", windowsHide: true }).trim();
      const proposal: LocalCodingTaskProposal = {
        schemaVersion: 1, repositoryId: "repo:verified", baseCommit: git(root, "rev-parse", "HEAD"),
        goal: "Change answer to beta", acceptanceCriteria: ["answer.txt contains beta"],
        nonObjectives: [], sourcePaths: ["answer.txt"], writablePaths: ["answer.txt"],
        requestedModelTargetId: "target:ollama:local",
        verification: { imageId, commands: [
          { kind: "git-diff-check", timeoutMs: 5_000 },
          { kind: "node-test-file", path: "pass.test.mjs", timeoutMs: 20_000 },
        ] },
        limits: { maximumAttempts: 1, maximumWallClockMs: 60_000, maximumOutputTokens: 256,
          maximumContextBytes: 4_096, maximumPatchBytes: 4_096, expiresAt: Date.now() + 120_000 },
      };
      const service = await LocalTaskService.open(root, async (view) => {
        expect(view.proposal.verification?.imageId).toBe(imageId);
        return "approved";
      }, async () => ({ text: JSON.stringify({ schemaVersion: 1,
        files: [{ path: "answer.txt", content: "beta\n" }] }) }), async () => "approved");
      let taskId: string;
      try {
        taskId = (await service.propose(proposal)).taskId;
        await service.review(taskId);
        expect((await service.run(taskId)).state).toBe("patch_ready");
        await expect(service.reviewResult(taskId)).rejects.toThrow("did not pass");
        const verified = await service.verify(taskId);
        expect(verified.verification?.outcome).toBe("passed");
        await expect(service.verify(taskId)).rejects.toThrow("already started");
      } finally { await service.close(); }
      const reopened = await LocalTaskService.open(root, async () => "rejected", undefined, async () => "approved");
      try {
        const evidence = await reopened.evidence(taskId!);
        expect(evidence.provenance?.verification?.outcome).toBe("passed");
        expect(evidence.provenance?.verification?.evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
        expect(evidence.provenance?.verification?.commands?.[1]?.argv).toContain("--network=none");
        expect(evidence.provenance?.verification?.commands?.[1]?.exitCode).toBe(0);
        expect(evidence.provenance?.verification?.commands?.[1]?.outputPreview).toBe("");
        expect((await reopened.reviewResult(taskId!)).state).toBe("accepted");
      } finally { await reopened.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 90_000);
}
