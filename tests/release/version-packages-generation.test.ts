import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

describe("version packages generation", () => {
  test("regenerates compiler artifacts after syncing the new version and fails closed on generation errors", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-version-generation-"));
    try {
      mkdirSync(join(root, "scripts"));
      mkdirSync(join(root, ".changeset"));
      mkdirSync(join(root, "src", "forge"), { recursive: true });
      mkdirSync(join(root, "bin"));
      mkdirSync(join(root, "node_modules", "@changesets", "cli"), { recursive: true });
      copyFileSync(
        join(process.cwd(), "scripts", "version-packages.mjs"),
        join(root, "scripts", "version-packages.mjs"),
      );
      copyFileSync(
        join(process.cwd(), "scripts", "release-channel-guard.mjs"),
        join(root, "scripts", "release-channel-guard.mjs"),
      );
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          name: "forgeos",
          type: "module",
          version: "0.1.0-alpha.63",
          publishConfig: { tag: "alpha" },
        }),
      );
      writeFileSync(
        join(root, ".changeset", "pre.json"),
        JSON.stringify({
          mode: "pre",
          tag: "alpha",
          initialVersions: { forgeos: "0.1.0-alpha.63" },
          changesets: [],
        }),
      );
      writeFileSync(
        join(root, "node_modules", "@changesets", "cli", "package.json"),
        JSON.stringify({ name: "@changesets/cli", type: "module" }),
      );
      writeFileSync(
        join(root, "node_modules", "@changesets", "cli", "bin.js"),
        [
          'import { readFileSync, writeFileSync } from "node:fs";',
          'const pkg = JSON.parse(readFileSync("package.json", "utf8"));',
          'pkg.version = "0.1.0-alpha.64";',
          'writeFileSync("package.json", JSON.stringify(pkg));',
        ].join("\n"),
      );
      writeFileSync(
        join(root, "bin", "forge.mjs"),
        [
          'import { readFileSync, writeFileSync } from "node:fs";',
          'if (process.argv[2] !== "generate") process.exit(2);',
          'const version = JSON.parse(readFileSync("package.json", "utf8")).version;',
          'const source = readFileSync("src/forge/version.ts", "utf8");',
          'if (!source.includes(version)) process.exit(3);',
          'writeFileSync("generated-version.txt", version);',
        ].join("\n"),
      );

      const run = () =>
        spawnSync(process.execPath, ["scripts/version-packages.mjs"], {
          cwd: root,
          encoding: "utf8",
          windowsHide: true,
        });
      const result = run();
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(root, "generated-version.txt"), "utf8")).toBe("0.1.0-alpha.64");
      expect(readFileSync(join(root, "src", "forge", "version.ts"), "utf8")).toContain("0.1.0-alpha.64");

      writeFileSync(join(root, "bin", "forge.mjs"), "process.exit(7);\n");
      expect(run().status).toBe(7);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
