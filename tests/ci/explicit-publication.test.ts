import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const npm = parse(readFileSync(".github/workflows/publish.yml", "utf8"));
const mirrors = parse(readFileSync(".github/workflows/github-packages.yml", "utf8"));
test("main preserves release PR and all validation gates while no step can publish or promote tags", () => {
  expect(npm.on.push.branches).toEqual(["main"]);
  const job = npm.jobs.changesets;
  expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
  const names = job.steps.map((step: any) => step.name);
  for (const name of ["Create Release PR", "Typecheck", "Generate release artifacts", "Security proof", "RLS mutation proof", "Release evidence and SBOM", "Dependency vulnerability evidence", "Test", "Regenerate release artifacts", "Smoke packed package", "Mark release gates passed"])
    expect(names).toContain(name);
  const code = JSON.stringify(job.steps);
  expect(code).not.toMatch(/npm (?:publish|dist-tag add)|publish-npm-alpha-package|release:publish/);
  expect(code).not.toContain("secrets.NPM_TOKEN");
  expect(code).not.toContain("publish: npm run release");
});
test("npm publishing keeps its gates and is reachable only by tags or explicit dispatch", () => {
  const job = npm.jobs["manual-publish"];
  expect(job.if).toBe("github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')");
  const names = job.steps.map((step: any) => step.name);
  for (const name of ["Enforce release channel", "Typecheck", "Security proof", "RLS mutation proof", "Release evidence and SBOM", "Dependency vulnerability evidence", "Test", "Smoke packed package", "Verify published public alpha"])
    expect(names).toContain(name);
  expect(names.indexOf("Publish to npm")).toBeGreaterThan(names.indexOf("Smoke packed package"));
});
test("GitHub Packages excludes main pushes and has an explicit-event job guard", () => {
  expect(mirrors.on.push.branches).toBeUndefined();
  expect(mirrors.on.push.tags).toEqual(["v*", "forgeos-v*"]);
  expect(mirrors.on).toHaveProperty("workflow_dispatch");
  expect(mirrors.jobs["publish-github-packages"].if).toBe("github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/')");
});

test("hosted security gate preserves broad tests and verifies backport and audit rejection cases", () => {
  const workflow = parse(readFileSync(".github/workflows/security-assurance.yml", "utf8"));
  const job = workflow.jobs["security-gate"];
  expect(job.defaults.run.shell).toBe("bash");
  const step = job.steps.find((step: any) => step.name === "Security assurance tests");
  expect(step.run).toContain("test tests/security tests/release/dependency-audit-policy.test.ts tests/release/nuxt-backports.test.ts --timeout 120000");
  expect(step.run).toContain("| tee security/evidence/latest/security-tests.txt");
});
