import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("CI workflow breadth", () => {
  test("covers Node smoke across OS and supported Node majors", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");

    expect(workflow).toContain("node-breadth:");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("node-version: [22, 24]");
    expect(workflow).toContain("node .\\bin\\forge.mjs doctor windows --json");
    expect(workflow).toContain("Minimal template package-manager smoke");
  });
});
