import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("GitHub Packages workflow", () => {
  test("publishes scoped package mirrors with GITHUB_TOKEN", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github", "workflows", "github-packages.yml"),
      "utf8",
    );
    const script = readFileSync(
      join(process.cwd(), "scripts", "publish-github-package.mjs"),
      "utf8",
    );

    expect(workflow).toContain("packages: write");
    expect(workflow).toContain('registry-url: "https://npm.pkg.github.com"');
    expect(workflow).toContain('scope: "@stahldavid"');
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(workflow).toContain("node scripts/publish-github-package.mjs");

    expect(script).toContain('"@stahldavid/forgeos"');
    expect(script).toContain('"@stahldavid/create-forgeos-app"');
    expect(script).toContain("https://npm.pkg.github.com");
    expect(script).toContain("already exists on GitHub Packages; skipping.");
  });
});
