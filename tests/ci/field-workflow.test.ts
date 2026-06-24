import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("field test workflow", () => {
  test("covers OS, Node, and package-manager breadth", () => {
    const workflow = readFileSync(".github/workflows/field-tests.yml", "utf8");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("public npm create smoke");
    expect(workflow).toContain("npm create forgeos-app@alpha smoke-app -- --template minimal-web --no-install --no-git");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("node-version: [22, 24]");
    expect(workflow).toContain("package-manager: [npm, pnpm, yarn, bun]");
    expect(workflow).toContain("scripts/field-test-forgeos.mjs");
    expect(workflow).toContain("minimal-web,nuxt-web");
    expect(workflow).toContain("--runtime-probes");
    expect(workflow).toContain("--write-report");
    expect(workflow).toContain("actions/upload-artifact@v4");
  });

  test("has a dedicated Nuxt template smoke with typecheck", () => {
    const workflow = readFileSync(".github/workflows/nuxt-template-smoke.yml", "utf8");
    expect(workflow).toContain("Nuxt Template Smoke");
    expect(workflow).toContain("--template nuxt-web");
    expect(workflow).toContain("--install");
    expect(workflow).toContain("npm run typecheck");
    expect(workflow).toContain("npm run dev -- --once --json");
  });
});
