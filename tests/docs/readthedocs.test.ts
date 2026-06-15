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
      "agent-contract.md",
      "field-testing.md",
      "release.md",
    ]) {
      expect(mkdocs).toContain(page);
      expect(existsSync(`docs/${page}`)).toBe(true);
    }
    expect(read("docs/getting-started.md")).toContain("forge new notes-app");
    expect(read("docs/field-testing.md")).toContain("npm run field:test");
  });
});
