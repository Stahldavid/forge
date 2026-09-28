import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChangeReviewService } from "../../src/forge/agent-fabric/local-change-review-service.ts";
import { localFabricPath } from "../../src/forge/agent-fabric/local-paths.ts";
import type { CodexAdversarialReviewOptions, CodexAdversarialReviewResult } from "../../src/forge/agent-fabric/codex-adversarial-review.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-change-review-"));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Forge Test");
  git(root, "config", "user.email", "forge-test@example.invalid");
  writeFileSync(join(root, "answer.txt"), "alpha\n");
  git(root, "add", "answer.txt");
  git(root, "commit", "-qm", "base");
  return root;
}

test("exact diff gate requires a new adversarial round after correction, including new files", async () => {
  const root = fixture();
  let verdict: "pass" | "changes_requested" = "pass";
  let calls = 0;
  const fake = async (options: CodexAdversarialReviewOptions): Promise<CodexAdversarialReviewResult> => {
    calls += 1;
    expect(existsSync(join(options.workspaceRoot, "answer.txt"))).toBe(true);
    expect(readFileSync(join(options.workspaceRoot, "answer.txt"), "utf8").replace(/\r\n/gu, "\n")).toBe("beta\n");
    return { state: "reported", report: { requestDigest: options.requestDigest, verdict,
      summary: verdict === "pass" ? "No findings" : "Fix needed",
      findings: verdict === "pass" ? [] : [{ severity: "high", path: "answer.txt", title: "Issue", explanation: "Test finding" }] },
      outputDigest: options.requestDigest };
  };
  try {
    const service = await LocalChangeReviewService.open(root, { reviewRunner: fake });
    const proposed = await service.propose({ objective: "Change answer", acceptanceCriteria: ["answer becomes beta"], implementer: "codex-app" });
    expect(proposed.state).toBe("proposed");
    writeFileSync(join(root, "answer.txt"), "beta\n");
    writeFileSync(join(root, "new.txt"), "new\n");
    const accepted = await service.review(proposed.changeId);
    expect(accepted.state).toBe("ready");
    expect(accepted.canAccept).toBe(true);
    expect((await service.evidence(proposed.changeId)).rounds).toHaveLength(1);
    writeFileSync(join(root, "new.txt"), "changed\n");
    expect((await service.status(proposed.changeId)).state).toBe("needs_review");
    expect((await service.status(proposed.changeId)).canAccept).toBe(false);
    verdict = "changes_requested";
    const rejected = await service.review(proposed.changeId);
    expect(rejected.state).toBe("changes_requested");
    expect(rejected.latestRound).toBe(2);
    expect(calls).toBe(2);
    await expect(service.review(proposed.changeId)).rejects.toThrow("already reviewed");
    await service.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test("interrupted intent and tampered patch fail closed without another reviewer call", async () => {
  const root = fixture();
  let calls = 0;
  try {
    const service = await LocalChangeReviewService.open(root, { reviewRunner: async (options) => {
      calls += 1;
      return { state: "reported", report: { requestDigest: options.requestDigest, verdict: "pass", summary: "OK", findings: [] },
        outputDigest: options.requestDigest };
    } });
    const proposed = await service.propose({ objective: "Change answer", acceptanceCriteria: ["beta"], implementer: "codex-app" });
    writeFileSync(join(root, "answer.txt"), "beta\n");
    await service.review(proposed.changeId);
    const directory = localFabricPath(root, "change-reviews", proposed.changeId.slice(7));
    unlinkSync(join(directory, "round-001.result.json"));
    expect((await service.status(proposed.changeId)).state).toBe("review_uncertain");
    await expect(service.review(proposed.changeId)).rejects.toThrow("Interrupted review");
    expect(calls).toBe(1);
    writeFileSync(join(directory, "round-001.patch"), "tampered");
    await expect(service.status(proposed.changeId)).rejects.toThrow("diff was modified");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test("same reviewer identity cannot review its own change", async () => {
  const root = fixture();
  try {
    const service = await LocalChangeReviewService.open(root, { reviewRunner: async () => { throw new Error("must not run"); } });
    const proposed = await service.propose({ objective: "Change answer", acceptanceCriteria: ["beta"], implementer: "codex-cli" });
    writeFileSync(join(root, "answer.txt"), "beta\n");
    await expect(service.review(proposed.changeId)).rejects.toThrow("cannot review its own");
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);

test("a completed inconclusive review can be retried explicitly and an orphan patch is reused", async () => {
  const root = fixture();
  let calls = 0;
  try {
    const service = await LocalChangeReviewService.open(root, { reviewRunner: async (options) => {
      calls += 1;
      return calls === 1 ? { state: "inconclusive", error: "invalid_agent_report" } :
        { state: "reported", report: { requestDigest: options.requestDigest, verdict: "pass", summary: "OK", findings: [] },
          outputDigest: options.requestDigest };
    } });
    const proposed = await service.propose({ objective: "Change answer", acceptanceCriteria: ["beta"], implementer: "codex-app" });
    writeFileSync(join(root, "answer.txt"), "beta\n");
    const directory = localFabricPath(root, "change-reviews", proposed.changeId.slice(7));
    writeFileSync(join(directory, "round-001.patch"), "orphaned pre-dispatch data");
    const first = await service.review(proposed.changeId);
    expect(first.state).toBe("inconclusive");
    const second = await service.review(proposed.changeId);
    expect(second.state).toBe("ready");
    expect(second.latestRound).toBe(2);
    expect(calls).toBe(2);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30_000);
