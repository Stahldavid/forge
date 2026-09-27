import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalAdaptiveService } from "../../src/forge/agent-fabric/local-adaptive-service.ts";
import { digestCanonical, sha256Digest } from "../../src/forge/agent-fabric/canonical.ts";
import { stableStringify } from "../../src/forge/agent-fabric/canonical.ts";
import { LocalEvolutionService } from "../../src/forge/agent-fabric/local-evolution-service.ts";
import { LOCAL_ADAPTIVE_EXTENSION_KEY } from "../../src/forge/agent-fabric/local-evolution-profile.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

const roots: string[] = [];
function root(): string {
  const path = mkdtempSync(join(tmpdir(), "forge-adaptive-"));
  roots.push(path);
  return path;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("local adaptive CLI service", () => {
  test("CLI accepts only the bounded adaptive workflow shape", () => {
    expect(parseCli(["fabric", "adaptive-propose", "--file", "input.json"]).command).toMatchObject({
      kind: "fabric", subcommand: "adaptive-propose", file: "input.json",
    });
    expect(parseCli(["fabric", "adaptive-propose"]).errors.length).toBeGreaterThan(0);
    expect(parseCli(["fabric", "adaptive-run"]).errors.length).toBeGreaterThan(0);
    expect(parseCli(["fabric", "adaptive-status", "abc"]).command).toMatchObject({
      kind: "fabric", subcommand: "adaptive-status", taskId: "abc",
    });
    expect(parseCli(["fabric", "adaptive-propose", "--file", "input.json", "--channel", "stable"]).command)
      .toMatchObject({ kind: "fabric", subcommand: "adaptive-propose", channel: "stable" });
    expect(parseCli(["fabric", "adaptive-propose", "--file", "input.json", "--channel", "other"]).errors.length)
      .toBeGreaterThan(0);
  });

  test("owner approval permits two processes, durable join survives reopening, and run cannot repeat", async () => {
    const path = root();
    let service = await LocalAdaptiveService.open(path, async () => "approved");
    const proposed = await service.propose({ inventory: "src/a.ts", constraints: "read only" });
    expect(proposed.phase).toBe("proposed");
    expect((await service.review(proposed.id)).phase).toBe("approved");
    const result = await service.run(proposed.id);
    expect(result.phase).toBe("succeeded");
    expect(result.journal.childOutcomes).toBe(2);
    expect(result.journal.joinOutcome?.status).toBe("succeeded");
    expect(result.result?.workerPids.inventory).not.toBe(result.result?.workerPids.constraints);
    await service.close();
    service = await LocalAdaptiveService.open(path, async () => { throw new Error("approval must not repeat"); });
    try {
      const readback = await service.status(proposed.id);
      expect(readback.journal.joinOutcome?.resultDigest).toBe(result.journal.joinOutcome?.resultDigest);
      expect(readback.result?.workerPids).toEqual(result.result?.workerPids);
      expect(service.run(proposed.id)).rejects.toThrow("unused owner approval");
    } finally { await service.close(); }
  });

  test("cancellation after permits leaves no authoritative join and cannot rerun", async () => {
    const path = root();
    const service = await LocalAdaptiveService.open(path, async () => "approved");
    try {
      const proposed = await service.propose({ inventory: "one", constraints: "two" });
      await service.review(proposed.id);
      const abort = new AbortController();
      abort.abort();
      const result = await service.run(proposed.id, abort.signal);
      expect(result.phase).toBe("uncertain");
      expect(result.journal.joinOutcome).toBeUndefined();
      expect(service.run(proposed.id)).rejects.toThrow("unused owner approval");
    } finally { await service.close(); }
  });

  test("approved input cannot be changed before permit issuance", async () => {
    const path = root();
    const service = await LocalAdaptiveService.open(path, async () => "approved");
    try {
      const proposed = await service.propose({ inventory: "one", constraints: "two" });
      await service.review(proposed.id);
      const recordPath = join(path, ".forge", "local", "agent-fabric", "adaptive-runs", `${proposed.id}.json`);
      const record = JSON.parse(readFileSync(recordPath, "utf8")) as Record<string, unknown>;
      record.input = { inventory: "changed", constraints: "two" };
      record.inputDigest = digestCanonical(record.input, sha256Digest);
      writeFileSync(recordPath, JSON.stringify(record));
      expect(service.run(proposed.id)).rejects.toThrow("does not match inputs");
      expect((await service.status(proposed.id)).journal.events).toBe(0);
    } finally { await service.close(); }
  });

  test("selected data profile is bound before review and revocation blocks permits", async () => {
    const path = root();
    const artifact = `${stableStringify({ schemaVersion: 1, kind: "local-adaptive-input-profile",
      inventory: { requiredLabel: "source", maxLength: 48 },
      constraints: { requiredLabel: "limits", maxLength: 48 } })}\n`;
    writeFileSync(join(path, "profile.json"), artifact);
    writeFileSync(join(path, "manifest.json"), JSON.stringify({ schemaVersion: 1,
      extensionKey: LOCAL_ADAPTIVE_EXTENSION_KEY, artifactPath: "profile.json" }));
    const evolution = await LocalEvolutionService.open(path, {
      async verify(challenge) {
        const challengeDigest = digestCanonical(challenge, sha256Digest);
        return { verifierId: "test-owner", challengeDigest, evidenceDigest: sha256Digest(challengeDigest) };
      },
    });
    const version = await evolution.register("manifest.json");
    await evolution.evaluate(version.version.versionId);
    await evolution.decide("promote", version.version.versionId);
    let reviewedVersion = "";
    const service = await LocalAdaptiveService.open(path, async (view) => {
      reviewedVersion = view.profile?.versionId ?? "";
      return "approved";
    });
    try {
      expect(service.propose({ inventory: "wrong:repo", constraints: "limits:read" }, "stable"))
        .rejects.toThrow("selected data profile");
      const first = await service.propose({ inventory: "source:repo", constraints: "limits:read" }, "stable");
      expect(first.profile?.versionId).toBe(version.version.versionId);
      await service.review(first.id);
      expect(reviewedVersion).toBe(version.version.versionId);
      const lock = join(path, ".forge", "local", "agent-fabric", "adaptive-lock");
      writeFileSync(lock, "running", { flag: "wx" });
      try {
        expect(evolution.decide("revoke", version.version.versionId)).rejects.toThrow("Adaptive owner is busy");
      } finally { unlinkSync(lock); }
      const succeeded = await service.run(first.id);
      expect(succeeded.phase).toBe("succeeded");
      expect(succeeded.profile?.versionId).toBe(version.version.versionId);
      const second = await service.propose({ inventory: "source:other", constraints: "limits:read" }, "stable");
      await service.review(second.id);
      await evolution.decide("revoke", version.version.versionId);
      expect(service.run(second.id)).rejects.toThrow();
      expect((await service.status(second.id)).journal.events).toBe(0);
    } finally { await service.close(); await evolution.close(); }
  }, 20_000);

  test("rejects extra keys and oversized UTF-8 before proposal persistence", async () => {
    const path = root();
    const service = await LocalAdaptiveService.open(path, async () => "approved");
    try {
      expect(service.propose({ inventory: "x", constraints: "y", command: "dir" })).rejects.toThrow();
      expect(service.propose({ inventory: "é".repeat(130), constraints: "x" })).rejects.toThrow();
    } finally { await service.close(); }
  });
});
