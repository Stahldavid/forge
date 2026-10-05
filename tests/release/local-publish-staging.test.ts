import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error Maintainer script is JavaScript and intentionally has no TypeScript declaration.
import { stageLocalPackage } from "../../scripts/publish-local-alpha.mjs";

test("local publish staging preserves npm exclusions and creates independent files", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-local-staging-"));
  try {
    const source = join(root, "source"); const stage = join(root, "stage");
    mkdirSync(join(source, "src", "generated"), { recursive: true });
    mkdirSync(stage);
    writeFileSync(join(source, "package.json"), JSON.stringify({ name: "forge-staging-fixture", version: "1.0.0", files: ["src/", "!src/generated/**", "src/generated/allowed.ts"] }));
    writeFileSync(join(source, "src", "index.ts"), "export const value = 1;");
    writeFileSync(join(source, "src", "generated", "private.ts"), "excluded");
    writeFileSync(join(source, "src", "generated", "allowed.ts"), "included");
    stageLocalPackage(source, stage);
    expect(JSON.parse(readFileSync(join(stage, "package.json"), "utf8")).files).toContain("!src/generated/**");
    expect(statSync(join(stage, "src", "index.ts")).nlink).toBe(1);
    const packed = spawnSync(process.platform === "win32" ? "cmd.exe" : "npm", process.platform === "win32" ? ["/d", "/c", "npm", "pack", "--dry-run", "--json"] : ["pack", "--dry-run", "--json"], { cwd: stage, encoding: "utf8", windowsHide: true });
    expect(packed.status).toBe(0);
    const paths = JSON.parse(packed.stdout)[0].files.map((file: { path: string }) => file.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/generated/allowed.ts");
    expect(paths).not.toContain("src/generated/private.ts");
    writeFileSync(join(stage, "src", "index.ts"), "changed");
    expect(readFileSync(join(source, "src", "index.ts"), "utf8")).toBe("export const value = 1;");
    writeFileSync(join(source, "package.json"), JSON.stringify({ files: ["../outside"] }));
    expect(() => stageLocalPackage(source, stage)).toThrow("Unsupported positive package file entry");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
