import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("CI workflow breadth", () => {
  test("covers Node smoke across OS and supported Node majors", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    const npmrc = readFileSync(join(process.cwd(), ".npmrc"), "utf8");
    const nodeBreadthJob = workflow.split("  external-quickstart:")[0]?.split("  node-breadth:")[1] ?? "";

    expect(workflow).toContain("node-breadth:");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("node-version: [22, 24]");
    expect(workflow).toContain("node ./bin/forge.mjs doctor --json");
    expect(workflow).toContain("node .\\bin\\forge.mjs doctor windows --json");
    expect(workflow).toContain("Minimal template package-manager smoke");
    expect(workflow).toContain("external-quickstart:");
    expect(workflow).toContain("External quickstart smoke");
    expect(workflow).toContain("--forge-spec \"file:$GITHUB_WORKSPACE\"");
    expect(workflow).toContain("npm run forge -- dev --once --json");
    expect(workflow).toContain("npm run forge -- verify --smoke --json --script-timeout-ms 120000");
    expect(nodeBreadthJob).toContain("node ./bin/forge.mjs doctor --json");
    expect(nodeBreadthJob).not.toContain("node ./bin/forge.mjs dev --once --json");
    expect(nodeBreadthJob).not.toContain("node ./bin/forge.mjs verify --smoke");
    expect(npmrc).toContain("legacy-peer-deps=true");
    expect(npmrc).toContain("package-lock=false");
    expect(workflow).toContain("npm install --ignore-scripts --package-lock=false");
  });
});
