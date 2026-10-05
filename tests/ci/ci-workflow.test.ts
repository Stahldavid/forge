import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("CI workflow breadth", () => {
  test("actual CI classifier skips unrelated templates and falls back safely without history", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8").replaceAll("\r\n", "\n");
    const script = workflow.split("node --input-type=module <<'NODE'\n")[1]!.split("          NODE")[0]!
      .split("\n").map(line => line.replace(/^          /, "")).join("\n");
    const fixture = mkdtempSync(join(tmpdir(), "forge-ci-paths-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: fixture, encoding: "utf8", windowsHide: true }).trim();
    try {
      git("init", "-q"); git("config", "user.name", "CI Fixture"); git("config", "user.email", "ci@example.invalid");
      writeFileSync(join(fixture, "baseline.txt"), "base"); git("add", "."); git("commit", "-qm", "base");
      const base = git("rev-parse", "HEAD");
      const classify = (paths: string | string[], expected: string) => {
        for (const path of typeof paths === "string" ? [paths] : paths) {
          mkdirSync(join(fixture, path, ".."), { recursive: true }); writeFileSync(join(fixture, path), "change");
        }
        git("add", "."); git("commit", "-qm", "change");
        const head = git("rev-parse", "HEAD"); const output = join(fixture, "ci-output"); writeFileSync(output, "");
        execFileSync(process.execPath, ["--input-type=module", "-e", script], {
          cwd: fixture, windowsHide: true, env: { ...process.env, BASE_SHA: base, HEAD_SHA: head, GITHUB_OUTPUT: output },
        });
        expect(readFileSync(output, "utf8")).toBe(expected);
        git("reset", "--hard", base);
      };
      classify("docs/a spaced file.md", "templates=false\npackage=false\nruntime=false\n");
      classify("src/forge/agent-fabric/module.ts", "templates=false\npackage=true\nruntime=true\n");
      classify(["src/forge/agent-fabric/module.ts", "src/forge/_generated/buildInfo.ts"], "templates=false\npackage=true\nruntime=true\n");
      classify(["src/forge/runtime.ts", "src/forge/_generated/buildInfo.ts"], "templates=true\npackage=true\nruntime=true\n");
      classify("templates/nuxt-web/package.json", "templates=true\npackage=true\nruntime=false\n");
      const output = join(fixture, "ci-output"); writeFileSync(output, "");
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: fixture, windowsHide: true, env: { ...process.env, BASE_SHA: "0".repeat(40), HEAD_SHA: base, GITHUB_OUTPUT: output },
      });
      expect(readFileSync(output, "utf8")).toBe("templates=true\npackage=true\nruntime=true\n");
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
  test("covers Node smoke across OS and supported Node majors", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "ci.yml"), "utf8");
    const security = readFileSync(join(process.cwd(), ".github", "workflows", "security-assurance.yml"), "utf8");
    const npmrc = readFileSync(join(process.cwd(), ".npmrc"), "utf8");
    const nodeBreadthJob = workflow.split("  external-quickstart:")[0]?.split("  node-breadth:")[1] ?? "";

    expect(workflow).toContain("node-breadth:");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("windows-latest");
    expect(workflow).toContain("macos-latest");
    expect(nodeBreadthJob).toContain("github.event_name == 'pull_request'");
    expect(nodeBreadthJob).toContain('"os":"windows-latest","node-version":22');
    expect(nodeBreadthJob).toContain('"os":"ubuntu-latest","node-version":24');
    expect(nodeBreadthJob).toContain('"os":"macos-latest","node-version":22');
    expect(workflow).toContain("node ./bin/forge.mjs inspect capabilities --json");
    expect(workflow).toContain("node .\\bin\\forge.mjs doctor windows --json");
    expect(workflow).toContain("package manager template smoke");
    expect(workflow).toContain("external-quickstart:");
    expect(workflow).toContain("External quickstart smoke");
    expect(workflow).toContain("--forge-spec \"file:$GITHUB_WORKSPACE\"");
    expect(workflow).toContain("npm run forge -- dev --once --json");
    expect(workflow).toContain("npm run forge -- verify --smoke --json --script-timeout-ms 120000");
    expect(workflow).toContain("Packed package smoke");
    expect(workflow).toContain("npm run release:smoke");
    expect(workflow).toContain("node ./bin/forge.mjs generate --check");
    expect(workflow.indexOf("run: node ./bin/forge.mjs generate\n"))
      .toBeLessThan(workflow.indexOf("run: node ./bin/forge.mjs generate --check"));
    expect(security).toContain("run: node ./bin/forge.mjs generate");
    expect(security).not.toContain("run: node ./bin/forge.mjs generate --check");
    expect(workflow).toContain("npm run lint");
    expect(workflow).toContain("run: bun test tests/ci --timeout 120000");
    expect(workflow).not.toContain("forge verify --standard");
    expect(security).toContain("test tests/security");
    expect(nodeBreadthJob).toContain("node ./bin/forge.mjs inspect capabilities --json");
    expect(nodeBreadthJob).not.toContain("node ./bin/forge.mjs dev --once --json");
    expect(nodeBreadthJob).not.toContain("node ./bin/forge.mjs verify --smoke");
    expect(npmrc).toContain("legacy-peer-deps=true");
    expect(npmrc).toContain("package-lock=false");
    expect(workflow).toContain("npm install --ignore-scripts --package-lock=false");
    const verifyJob = workflow.split("  packed-package:")[0]?.split("  verify:")[1] ?? "";
    expect(verifyJob).not.toContain("npm run release:smoke");
    expect(workflow).toContain("  packed-package:");
    expect(workflow).toContain("if: needs.changes.outputs.templates == 'true'");
    expect(workflow).toContain("if: needs.changes.outputs.package == 'true'");
    expect(workflow).toContain("bun install --frozen-lockfile --ignore-scripts");
  });
});
