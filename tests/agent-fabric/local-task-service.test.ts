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
        const running = service.run(proposed.taskId);
        await modelStarted;
        const inFlight = await service.status(proposed.taskId);
        expect(inFlight.state).toBe("model_uncertain");
        releaseModel();
        const completed = await running;
        expect(completed.state).toBe("patch_ready");
        expect(completed.patch?.changedPaths).toEqual(["source.txt"]);
        await expect(service.run(proposed.taskId)).rejects.toThrow();
      } finally {
        await service.close();
      }
      const reopened = await LocalTaskService.open(root, async () => "rejected", undefined, async () => "approved");
      try {
        const status = await reopened.propose(proposal);
        expect(status.state).toBe("patch_ready");
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
