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
    expect(workflow).toContain("node ./bin/forge.mjs rls test --db postgres --json");
    expect(workflow).toContain("node ./bin/forge.mjs rls mutate-test --json");
    expect(workflow).toContain("node ./bin/forge.mjs security prove --db postgres --full --json");
    expect(workflow).toContain("npm run security:evidence -- security/evidence/latest/security-proof.json security/evidence/latest");
    expect(workflow).toContain("npm run release:evidence -- security/evidence/latest");
    expect(workflow).toContain("security/evidence/latest/security-proof.json");
    expect(workflow).toContain("AI_GATEWAY_API_KEY: forge-ci-redacted-ai-gateway-key");
    expect(workflow).toContain("ANTHROPIC_API_KEY: forge-ci-redacted-anthropic-key");
    expect(workflow).toContain("OPENAI_API_KEY: forge-ci-redacted-openai-key");
    expect(workflow).toContain("node ./bin/forge.mjs verify --strict");
    expect(workflow).toContain("node ./bin/forge-bun.mjs test tests/security");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("security/evidence/latest");
  });
});
