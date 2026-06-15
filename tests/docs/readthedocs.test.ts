import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const PUBLIC_PAGES = [
  "index.md",
  "getting-started.md",
  "templates.md",
  "agent-workflow.md",
  "cli.md",
  "runtime-model.md",
  "frontend.md",
  "ai.md",
  "security-and-data.md",
  "authoring.md",
  "forge-add.md",
  "recipes.md",
  "payments.md",
  "codemods.md",
  "agent-contract.md",
  "testing-and-repair.md",
  "troubleshooting.md",
  "field-testing.md",
  "self-host.md",
  "release.md",
  "changelog.md",
] as const;

describe("ReadTheDocs documentation", () => {
  test("has a v2 ReadTheDocs MkDocs configuration", () => {
    const config = read(".readthedocs.yaml");
    expect(config).toContain("version: 2");
    expect(config).toContain("python: \"3.12\"");
    expect(config).toContain("configuration: mkdocs.yml");
    expect(config).toContain("requirements: docs/requirements.txt");
  });

  test("uses Material theme with RTD-safe defaults", () => {
    const mkdocs = read("mkdocs.yml");
    expect(mkdocs).toContain("name: material");
    expect(mkdocs).not.toContain("markdown_extensions:");
    expect(mkdocs).not.toContain("!!python/name:");
    const requirements = read("docs/requirements.txt");
    expect(requirements).toContain("mkdocs==1.6.1");
    expect(requirements).toContain("mkdocs-material");
    expect(requirements).toContain("pymdown-extensions");
  });

  test("has a navigable public documentation skeleton", () => {
    const mkdocs = read("mkdocs.yml");
    for (const page of PUBLIC_PAGES) {
      expect(mkdocs).toContain(page);
      expect(existsSync(`docs/${page}`)).toBe(true);
    }
    expect(read("docs/getting-started.md")).toContain("npm create forge-app@alpha");
    expect(read("docs/index.md")).toContain("npm create forge-app@alpha");
    expect(read("docs/index.md")).toContain("Agent Workflow");
    expect(read("docs/agent-workflow.md")).toContain("forge do");
    expect(read("docs/frontend.md")).toContain("useLiveQuery");
    expect(read("docs/security-and-data.md")).toContain("forge rls check");
    expect(read("docs/authoring.md")).toContain("forge make resource");
    expect(read("docs/testing-and-repair.md")).toContain("forge verify --strict");
    expect(read("docs/self-host.md")).toContain("forge self-host check");
    expect(read("docs/templates.md")).toContain("b2b-support-web");
    expect(read("docs/field-testing.md")).toContain("npm run field:test");
    expect(read("docs/forge-add.md")).toContain("forge add stripe");
    expect(read("docs/forge-add.md")).toContain("forge deps api");
    expect(read("docs/payments.md")).toContain("checkout.requested");
    expect(read("docs/codemods.md")).toContain("extract-action");
    expect(read("docs/codemods.md")).toContain("rename command");
    expect(read("docs/troubleshooting.md")).toContain("FORGE_GUARD_VIOLATION");
    expect(read("docs/troubleshooting.md")).toContain("FORGE_AI_FORBIDDEN_CONTEXT");
    expect(read("docs/troubleshooting.md")).toContain("LiveQuery stale");
    expect(read("docs/agent-contract.md")).toContain("forge agent export");
    expect(read("docs/ai.md")).toContain("ctx.ai.generateText");
    expect(read("docs/ai.md")).toContain("generateStructured");
    expect(read("docs/ai.md")).toContain("forge make ai-chat");
    expect(read("docs/cli.md")).toContain("forge ai trace");
    expect(read("docs/cli.md")).toContain("forge deps api");
    expect(read("docs/cli.md")).toContain("forge verify --smoke");
    expect(read("docs/runtime-model.md")).toContain("ctx.agent.run");
    expect(read("docs/release.md")).toContain("create-forge-app@alpha");
    expect(read("docs/changelog.md")).toContain("0.1.0-alpha.3");
  });
});
