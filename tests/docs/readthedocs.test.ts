import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

describe("ReadTheDocs documentation", () => {
  test("has a v2 ReadTheDocs MkDocs configuration", () => {
    const config = read(".readthedocs.yaml");
    expect(config).toContain("version: 2");
    expect(config).toContain("python: \"3.12\"");
    expect(config).toContain("configuration: mkdocs.yml");
    expect(config).toContain("requirements: docs/requirements.txt");
  });

  test("has a navigable public documentation skeleton", () => {
    const mkdocs = read("mkdocs.yml");
    for (const page of [
      "index.md",
      "getting-started.md",
      "cli.md",
      "runtime-model.md",
      "forge-add.md",
      "recipes.md",
      "payments.md",
      "codemods.md",
      "agent-contract.md",
      "troubleshooting.md",
      "field-testing.md",
      "release.md",
    ]) {
      expect(mkdocs).toContain(page);
      expect(existsSync(`docs/${page}`)).toBe(true);
    }
    expect(read("docs/getting-started.md")).toContain("forge new notes-app");
    expect(read("docs/field-testing.md")).toContain("npm run field:test");
    expect(read("docs/forge-add.md")).toContain("forge add stripe");
    expect(read("docs/payments.md")).toContain("checkout.requested");
    expect(read("docs/codemods.md")).toContain("extract-action");
    expect(read("docs/troubleshooting.md")).toContain("FORGE_GUARD_VIOLATION");
  });
});
