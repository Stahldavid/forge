import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

describe("security evidence script", () => {
  test("extracts security proof JSON when postgres notices precede it", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-security-evidence-"));
    try {
      const proofPath = join(root, "security-proof.json");
      const outputDir = join(root, "out");
      const proof = {
        schemaVersion: "0.1.0",
        kind: "security-proof",
        assurance: "postgres-proved",
        evidence: {
          invariants: [
            {
              id: "INV-001",
              artifact: "auth-negative",
              level: "tested",
              summary: "Auth proof",
              tests: ["tests/security/auth-negative.test.ts"],
              commands: ["node ./bin/forge-bun.mjs test tests/security/auth-negative.test.ts"],
            },
          ],
        },
        summary: {
          passed: ["auth-proof"],
          failed: [],
          warnings: [],
        },
      };
      writeFileSync(
        proofPath,
        `{
  severity_local: 'NOTICE',
  message: 'relation already exists, skipping'
}
${JSON.stringify(proof, null, 2)}
`,
        "utf8",
      );

      const result = spawnSync(
        process.execPath,
        ["scripts/write-security-evidence.mjs", proofPath, outputDir],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("wrote 1 security evidence artifact");
      const artifact = JSON.parse(readFileSync(join(outputDir, "auth-negative.json"), "utf8")) as {
        kind: string;
        invariant: { id: string };
      };
      expect(artifact.kind).toBe("security-invariant-evidence");
      expect(artifact.invariant.id).toBe("INV-001");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
