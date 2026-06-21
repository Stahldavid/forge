import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const PUBLIC_PAGES = [
  "index.md",
  "getting-started.md",
  "tutorial-first-app.md",
  "why-forgeos.md",
  "capabilities.md",
  "architecture.md",
  "examples.md",
  "templates.md",
  "agent-workflow.md",
  "agent-playbook.md",
  "agent-feature-tutorial.md",
  "dev-loop.md",
  "cli.md",
  "cli-reference.md",
  "runtime-model.md",
  "runtime-by-example.md",
  "frontend.md",
  "frontend-integration-guide.md",
  "ai.md",
  "ai-agents.md",
  "security-and-data.md",
  "authoring.md",
  "forge-add.md",
  "package-intelligence.md",
  "recipes.md",
  "payments.md",
  "codemods.md",
  "agent-contract.md",
  "testing-and-repair.md",
  "troubleshooting.md",
  "field-testing.md",
  "production-readiness.md",
  "threat-model.md",
  "security-assurance.md",
  "security-standards.md",
  "operations.md",
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
    expect(config).toContain("fail_on_warning: true");
    expect(config).toContain("requirements: docs/requirements.txt");
    expect(config).toContain("search:");
    expect(config).toContain("docs/why-forgeos.md: 10");
    expect(config).toContain("docs/agent-playbook.md: 9");
    expect(config).toContain("docs/dev-loop.md: 9");
    expect(config).toContain("docs/package-intelligence.md: 8");
  });

  test("uses Material theme with RTD-safe defaults", () => {
    const mkdocs = read("mkdocs.yml");
    expect(mkdocs).toContain("name: material");
    expect(mkdocs).toContain("markdown_extensions:");
    expect(mkdocs).toContain("fenced_code");
    expect(mkdocs).toContain("extra_css:");
    expect(mkdocs).toContain("stylesheets/forge.css");
    expect(mkdocs).toContain("extra_javascript:");
    expect(mkdocs).toContain("javascripts/mermaid-init.js");
    expect(mkdocs).not.toContain("navigation.instant");
    expect(existsSync("docs/stylesheets/forge.css")).toBe(true);
    expect(existsSync("docs/javascripts/mermaid-init.js")).toBe(true);
    const extraCss = read("docs/stylesheets/forge.css");
    expect(extraCss).not.toContain(".md-main");
    expect(extraCss).not.toContain(".md-main__inner");
    expect(extraCss).not.toContain(".md-content {");
    expect(extraCss).not.toContain(".md-content__inner");
    expect(extraCss).not.toContain(".md-sidebar--primary");
    expect(extraCss).not.toContain(".md-sidebar--secondary");
    const requirements = read("docs/requirements.txt");
    expect(requirements).toContain("mkdocs==1.6.1");
    expect(requirements).toContain("mkdocs-material");
    expect(requirements).toContain("pymdown-extensions");
    const gitattributes = read(".gitattributes");
    expect(gitattributes).toContain("docs/**/*.md text eol=lf");
  });

  test("has a navigable public documentation skeleton", () => {
    const mkdocs = read("mkdocs.yml");
    for (const page of PUBLIC_PAGES) {
      expect(mkdocs).toContain(page);
      expect(existsSync(`docs/${page}`)).toBe(true);
    }
    expect(read("docs/getting-started.md")).toContain("npm create forgeos-app@alpha");
    expect(read("docs/getting-started.md")).toContain("Open the web URL");
    expect(read("docs/tutorial-first-app.md")).toContain("npm run forge -- dev --once --json");
    expect(read("docs/architecture.md")).toContain("flowchart TD");
    expect(read("docs/architecture.md")).toContain("Package and integration contract");
    expect(read("docs/architecture.md")).toContain("forge deps runtime-compat");
    expect(read("docs/examples.md")).toContain("Initial source tree");
    expect(read("docs/examples.md")).toContain("Public proof app");
    expect(read("docs/examples.md")).toContain("npm run proof:capabilities");
    expect(read("docs/index.md")).toContain("npm create forgeos-app@alpha");
    expect(read("docs/index.md")).toContain("Agent Workflow");
    expect(read("docs/index.md")).toContain("Inspect SDK APIs before coding");
    expect(read("docs/capabilities.md")).toContain("H39-H43");
    expect(read("docs/capabilities.md")).toContain("Native AI agents");
    expect(read("docs/agent-workflow.md")).toContain("forge do");
    expect(read("docs/agent-workflow.md")).toContain("forge status --json");
    expect(read("docs/agent-workflow.md")).toContain("forge handoff --json");
    expect(read("docs/agent-workflow.md")).toContain("Integration change loop");
    expect(read("docs/agent-workflow.md")).toContain("forge deps api stripe checkout.sessions.create");
    expect(read("docs/agent-playbook.md")).toContain("issue-to-handoff loop");
    expect(read("docs/agent-playbook.md")).toContain("forge status --json");
    expect(read("docs/agent-playbook.md")).toContain("forge handoff --json");
    expect(read("docs/agent-playbook.md")).toContain("forge review run --changed --json");
    expect(read("docs/agent-feature-tutorial.md")).toContain("forge make resource task");
    expect(read("docs/agent-feature-tutorial.md")).toContain("Add integrations only through Forge");
    expect(read("docs/dev-loop.md")).toContain("forge dev --once --json");
    expect(read("docs/dev-loop.md")).toContain("API URL");
    expect(read("docs/runtime-by-example.md")).toContain("create support tickets");
    expect(read("docs/runtime-by-example.md")).toContain("ctx.emit");
    expect(read("docs/frontend.md")).toContain("useLiveQuery");
    expect(read("docs/frontend-integration-guide.md")).toContain("ForgeProvider");
    expect(read("docs/frontend-integration-guide.md")).toContain("Capability map");
    expect(read("docs/security-and-data.md")).toContain("forge rls check");
    expect(read("docs/security-and-data.md")).toContain("forge rls mutate-test --json");
    expect(read("docs/authoring.md")).toContain("forge make resource");
    expect(read("docs/testing-and-repair.md")).toContain("forge verify --strict");
    expect(read("docs/self-host.md")).toContain("forge self-host check");
    expect(read("docs/templates.md")).toContain("b2b-support-web");
    expect(read("docs/field-testing.md")).toContain("npm run field:test");
    expect(read("docs/field-testing.md")).toContain("--runtime-probes");
    expect(read("docs/field-testing.md")).toContain("GET /health");
    expect(read("docs/field-testing.md")).toContain("POST /commands");
    expect(read("docs/field-testing.md")).toContain("field-report");
    expect(read("docs/forge-add.md")).toContain("forge add stripe");
    expect(read("docs/forge-add.md")).toContain("forge deps api");
    expect(read("docs/forge-add.md")).toContain("summarizes the useful API surface");
    expect(read("docs/package-intelligence.md")).toContain("forge deps runtime-compat");
    expect(read("docs/package-intelligence.md")).toContain("The agent should not call an SDK from memory");
    expect(read("docs/payments.md")).toContain("checkout.requested");
    expect(read("docs/payments.md")).toContain("verifyWebhookSignature");
    expect(read("docs/codemods.md")).toContain("extract-action");
    expect(read("docs/codemods.md")).toContain("rename command");
    expect(read("docs/troubleshooting.md")).toContain("FORGE_GUARD_VIOLATION");
    expect(read("docs/troubleshooting.md")).toContain("FORGE_AI_FORBIDDEN_CONTEXT");
    expect(read("docs/troubleshooting.md")).toContain("LiveQuery stale");
    expect(read("docs/troubleshooting.md")).toContain("Error map");
    expect(read("docs/troubleshooting.md")).toContain("forge handoff --json");
    expect(read("docs/agent-contract.md")).toContain("forge agent export");
    expect(read("docs/agent-contract.md")).toContain("dependencyApis");
    expect(read("docs/agent-contract.md")).toContain("Package API evidence");
    expect(read("docs/ai.md")).toContain("ctx.ai.generateText");
    expect(read("docs/ai.md")).toContain("generateStructured");
    expect(read("docs/ai.md")).toContain("Choose the right AI path");
    expect(read("docs/ai.md")).toContain("forge make ai-chat");
    expect(read("docs/ai.md")).toContain("forge deps api @ai-sdk/openai createOpenAI");
    expect(read("docs/ai-agents.md")).toContain("aiTool");
    expect(read("docs/ai-agents.md")).toContain("/ai/agents/chat");
    expect(read("docs/cli.md")).toContain("forge ai trace");
    expect(read("docs/cli.md")).toContain("forge status --json");
    expect(read("docs/cli.md")).toContain("forge handoff --json");
    expect(read("docs/cli.md")).toContain("forge inspect all --full --json");
    expect(read("docs/cli.md")).toContain("forge deps api");
    expect(read("docs/cli.md")).toContain("Dependency API oracle");
    expect(read("docs/why-forgeos.md")).toContain("Add integrations safely");
    expect(read("docs/why-forgeos.md")).toContain("Forge dependency API oracle");
    expect(read("docs/cli.md")).toContain("forge verify --smoke");
    expect(read("docs/runtime-model.md")).toContain("ctx.agent.run");
    expect(read("docs/operations.md")).toContain("forge doctor windows --json");
    expect(read("docs/operations.md")).toContain("forge verify --strict --script-timeout-ms");
    expect(read("docs/production-readiness.md")).toContain("Production Readiness");
    expect(read("docs/production-readiness.md")).toContain("Strong alpha");
    expect(read("docs/production-readiness.md")).toContain("Minimum production checklist");
    expect(read("docs/production-readiness.md")).toContain("Agent safety checklist");
    expect(read("docs/production-readiness.md")).toContain("Field-test evidence expected before promotion");
    expect(read("docs/threat-model.md")).toContain("Threat Model");
    expect(read("docs/threat-model.md")).toContain("Trust boundaries");
    expect(read("docs/threat-model.md")).toContain("AI tool abuse");
    expect(read("docs/threat-model.md")).toContain("Minimum security review before production");
    expect(read("docs/threat-model.md")).toContain("Known gaps");
    expect(read("docs/threat-model.md")).toContain("forge ai redteam --json");
    expect(read("docs/security-assurance.md")).toContain("SECURITY_INVARIANTS.md");
    expect(read("docs/security-assurance.md")).toContain("security-assurance.yml");
    expect(read("docs/security-assurance.md")).toContain("forge security prove --db postgres --full --json");
    expect(read("docs/security-assurance.md")).toContain("forge rls mutate-test --json");
    expect(read("docs/security-assurance.md")).toContain("sbom.cyclonedx.json");
    expect(read("docs/security-assurance.md")).toContain("structural-only");
    expect(read("docs/security-assurance.md")).toContain("postgres-proved");
    expect(read("docs/security-assurance.md")).toContain("tests/security");
    expect(read("docs/security-assurance.md")).toContain("security/evidence/latest");
    expect(read("docs/security-standards.md")).toContain("security/STANDARDS_CROSSWALK.md");
    expect(read("docs/security-standards.md")).toContain("OWASP LLM Top 10");
    expect(read("docs/security-standards.md")).toContain("forge security prove --json");
    expect(read("docs/security-standards.md")).toContain("tests/security/auth-negative.test.ts");
    expect(read("docs/security-standards.md")).toContain("tests/security/tenant-isolation/runtime-api.test.ts");
    expect(read("docs/security-standards.md")).toContain("tests/security/tenant-isolation/http-runtime.test.ts");
    expect(read("docs/security-standards.md")).toContain("tests/security/webhooks/webhook-security.test.ts");
    expect(read("docs/security-standards.md")).toContain("NPM_CONFIG_PROVENANCE=true");
    expect(read("docs/cli-reference.md")).toContain("forge auth prove --json");
    expect(read("docs/cli-reference.md")).toContain("forge status --json");
    expect(read("docs/cli-reference.md")).toContain("forge handoff --json");
    expect(read("docs/cli-reference.md")).toContain("forge inspect all --full --json");
    expect(read("docs/cli-reference.md")).toContain("forge rls mutate-test --json");
    expect(read("docs/cli-reference.md")).toContain("forge ai redteam --json");
    expect(read("docs/cli-reference.md")).toContain("npm run release:publish-alpha");
    expect(read("docs/production-readiness.md")).toContain("Threat Model");
    expect(read("docs/security-and-data.md")).toContain("Production Readiness");
    expect(read("docs/security-and-data.md")).toContain("Threat Model");
    expect(read("docs/ai-agents.md")).toContain("Threat Model");
    expect(read("docs/release.md")).toContain("docs/production-readiness.md");
    expect(read("docs/release.md")).toContain("docs/threat-model.md");
    expect(read("docs/release.md")).toContain("create-forgeos-app@alpha");
    expect(read("docs/release.md")).toContain("security prove --db postgres --full --json");
    expect(read("docs/release.md")).toContain("release:verify-public-alpha");
    expect(read("docs/release.md")).toContain("npm run release:evidence");
    expect(read("docs/release.md")).toContain("Security Standards Crosswalk");
    expect(read("docs/release.md")).toContain("Documentation checklist");
    expect(read("docs/changelog.md")).toContain("0.1.0-alpha.5");
  });
});
