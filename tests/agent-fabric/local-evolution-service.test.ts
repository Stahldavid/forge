import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { digestCanonical, sha256Digest, stableStringify } from "../../src/forge/agent-fabric/canonical.ts";
import { localEvolutionOwnerVerifier } from "../../src/forge/agent-fabric/local-evolution-approval.ts";
import { LocalEvolutionService } from "../../src/forge/agent-fabric/local-evolution-service.ts";
import { LOCAL_ADAPTIVE_EXTENSION_KEY } from "../../src/forge/agent-fabric/local-evolution-profile.ts";
import { hasUnknownOption, parseCli } from "../../src/forge/cli/parse.ts";

describe("local extension owner workflow", () => {
  test("CLI parses the owner path and its options", () => {
    const register = ["evolution", "register", "--manifest", "extension.json", "--json"];
    expect(hasUnknownOption(register)).toBeNull();
    expect(parseCli(register).command).toMatchObject({ kind: "evolution", subcommand: "register", manifest: "extension.json" });
    const review = ["evolution", "review", "promote", `extension:${sha256Digest("version")}`, "--json"];
    expect(parseCli(review).command).toMatchObject({ kind: "evolution", subcommand: "review", action: "promote" });
    const load = ["evolution", "load", LOCAL_ADAPTIVE_EXTENSION_KEY, "--channel", "stable", "--json"];
    expect(hasUnknownOption(load)).toBeNull();
    expect(parseCli(load).command).toMatchObject({ kind: "evolution", subcommand: "load", channel: "stable" });
  });

  test("pins bytes, evaluates fixed suite, requires review, and blocks revoked loading", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-evolution-service-"));
    let allowed = false;
    const verifier = { async verify(challenge: Parameters<ReturnType<typeof localEvolutionOwnerVerifier>["verify"]>[0]) {
      if (!allowed) throw new Error("owner declined");
      const challengeDigest = digestCanonical(challenge, sha256Digest);
      return { verifierId: "test-owner", challengeDigest, evidenceDigest: sha256Digest(`approved:${challengeDigest}`) };
    } };
    const artifact = `${stableStringify({
      schemaVersion: 1, kind: "local-adaptive-input-profile",
      inventory: { requiredLabel: "source", maxLength: 48 },
      constraints: { requiredLabel: "limits", maxLength: 40 },
    })}\n`;
    writeFileSync(join(root, "extension-profile.json"), artifact);
    writeFileSync(join(root, "extension.json"), JSON.stringify({
      schemaVersion: 1, extensionKey: LOCAL_ADAPTIVE_EXTENSION_KEY, artifactPath: "extension-profile.json",
    }));
    let service = await LocalEvolutionService.open(root, verifier);
    try {
      const first = await service.register("extension.json");
      expect(first.version.versionId).toMatch(/^extension:sha256:/u);
      await expect(service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "stable")).rejects.toMatchObject({ code: "AF_CONFLICT" });
      expect((await service.evaluate(first.version.versionId)).evaluation?.state).toBe("passed");
      await expect(service.decide("promote", first.version.versionId)).rejects.toThrow("owner declined");
      await expect(service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "stable")).rejects.toMatchObject({ code: "AF_CONFLICT" });
      allowed = true;
      expect((await service.decide("canary", first.version.versionId)).channels).toContain("canary");
      expect((await service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "canary")).artifact.toString()).toBe(artifact);
      await service.decide("promote", first.version.versionId);
      expect((await service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "stable")).versionId).toBe(first.version.versionId);
      const resolved = await service.resolveSelectedLocalAdaptiveInputs("stable", "attempt:profile-1",
        "source:repo", "limits:no network");
      expect(resolved).toEqual({ versionId: first.version.versionId,
        inventory: "source:repo", constraints: "limits:no network" });
      expect((await service.registry.getAttempt("attempt:profile-1"))?.versionId)
        .toBe(first.version.versionId);
      await expect(service.resolveSelectedLocalAdaptiveInputs("stable", "attempt:profile-1",
        "source:repo", "limits:no network")).rejects.toMatchObject({ code: "AF_CONFLICT" });
      await expect(service.resolveSelectedLocalAdaptiveInputs("stable", "attempt:profile-2",
        "wrong:repo", "limits:no network")).rejects.toMatchObject({ code: "AF_INVALID_STATE" });
      await expect(service.resolveSelectedLocalAdaptiveInputs("stable", "attempt:profile-3",
        `source:${"x".repeat(48)}`, "limits:no network")).rejects.toMatchObject({ code: "AF_INVALID_STATE" });
      expect(await service.registry.getAttempt("attempt:profile-2")).toBeNull();
      expect(await service.registry.getAttempt("attempt:profile-3")).toBeNull();
      writeFileSync(join(root, "extension-profile.json"), "changed source after registration");
      expect((await service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "stable")).artifact.toString()).toBe(artifact);
      await service.decide("revoke", first.version.versionId);
      expect((await service.status(first.version.versionId)).revoked).toBe(true);
      await expect(service.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, "stable")).rejects.toMatchObject({ code: "AF_CONFLICT" });
      await expect(service.decide("promote", first.version.versionId)).rejects.toMatchObject({ code: "AF_CONFLICT" });
    } finally { await service.close(); rmSync(root, { recursive: true, force: true }); }
  });

  test("fixed suite fails incompatible artifacts and blocks selection", async () => {
    const root = mkdtempSync(join(tmpdir(), "forge-evolution-invalid-"));
    try {
      writeFileSync(join(root, "extension-profile.json"), "export const value = 1;\n");
      writeFileSync(join(root, "extension.json"), JSON.stringify({
        schemaVersion: 1, extensionKey: LOCAL_ADAPTIVE_EXTENSION_KEY,
        artifactPath: "extension-profile.json",
      }));
      const service = await LocalEvolutionService.open(root, {
        async verify() { throw new Error("owner ingress must not be reached"); },
      });
      try {
        const version = await service.register("extension.json");
        const status = await service.evaluate(version.version.versionId);
        expect(status.evaluation?.state).toBe("failed");
        expect(status.evaluation?.cases.find((item) => item.caseId === "profile-contract")?.passed).toBe(false);
        expect(status.evaluation?.cases.find((item) => item.caseId === "artifact-integrity")?.passed).toBe(true);
        await expect(service.decide("promote", version.version.versionId))
          .rejects.toMatchObject({ code: "AF_CONFLICT" });
      } finally { await service.close(); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("owner window binds approval to the displayed decision digest", async () => {
    const verifier = localEvolutionOwnerVerifier({ openBrowser: async (url) => {
      const page = await fetch(url);
      expect(page.status).toBe(200);
      const html = await page.text();
      const digest = html.match(/name="digest" value="([^"]+)"/u)?.[1];
      expect(digest).toMatch(/^sha256:/u);
      const endpoint = new URL(url);
      const rejected = await fetch(`${endpoint.origin}/decision/${endpoint.pathname.slice(1)}`, {
        method: "POST", headers: { origin: endpoint.origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ digest: sha256Digest("wrong"), decision: "approved" }),
      });
      expect(rejected.status).toBe(400);
      const approved = await fetch(`${endpoint.origin}/decision/${endpoint.pathname.slice(1)}`, {
        method: "POST", headers: { origin: endpoint.origin, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ digest: digest!, decision: "approved" }),
      });
      expect(approved.status).toBe(200);
    } });
    const proof = await verifier.verify({ decisionNonce: "nonce", action: "promote",
      versionId: `extension:${sha256Digest("version")}`, extensionKey: "sample",
      expectedSelection: null, evaluationDigest: sha256Digest("eval") });
    expect(proof.verifierId).toBe("local-owner-window");
  });
});
