import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/security-assurance.yml", "utf8");

describe("security assurance workflow", () => {
  test("runs the public security gate and stores evidence", () => {
    expect(workflow).toContain("name: Security Assurance");
    expect(workflow).toContain("postgres:16");
    expect(workflow).toContain("node ./bin/forge.mjs generate --check");
    expect(workflow).toContain("node ./bin/forge.mjs check --json");
    expect(workflow).toContain("node ./bin/forge.mjs auth check --json");
    expect(workflow).toContain("node ./bin/forge.mjs secrets check --json");
    expect(workflow).toContain("node ./bin/forge.mjs rls check --json");
    expect(workflow).toContain("node ./bin/forge.mjs verify --strict");
    expect(workflow).toContain("node ./bin/forge-bun.mjs test tests/security");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("security/evidence/latest");
  });
});
