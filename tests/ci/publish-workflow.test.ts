import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("npm publish workflow", () => {
  test("uses Trusted Publisher OIDC without an npm token", () => {
    const workflow = readFileSync(join(process.cwd(), ".github", "workflows", "publish.yml"), "utf8");
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      name?: string;
      bin?: Record<string, string>;
      publishConfig?: Record<string, unknown>;
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe("forgeos");
    expect(pkg.bin?.forge).toBe("bin/forge.mjs");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.publishConfig?.tag).toBe("alpha");
    expect(pkg.scripts?.release).toBe("changeset publish");
    expect(pkg.scripts?.["release:smoke"]).toBe("node scripts/smoke-packed-package.mjs");
    expect(pkg.scripts?.["release:evidence"]).toBe("node scripts/write-release-evidence.mjs");
    expect(pkg.scripts?.["release:verify-public-alpha"]).toBe("node scripts/verify-public-alpha.mjs");
    expect(pkg.scripts?.["security:evidence"]).toBe("node scripts/write-security-evidence.mjs");

    const createPkg = JSON.parse(
      readFileSync(join(process.cwd(), "packages", "create-forge-app", "package.json"), "utf8"),
    ) as {
      name?: string;
      bin?: Record<string, string>;
      publishConfig?: Record<string, unknown>;
    };
    expect(createPkg.name).toBe("create-forgeos-app");
    expect(createPkg.bin?.["create-forgeos-app"]).toBe("bin/create-forge-app.mjs");
    expect(createPkg.bin?.["create-forge-app"]).toBe("bin/create-forge-app.mjs");
    expect(createPkg.bin?.["forgeos-app"]).toBe("bin/create-forge-app.mjs");
    expect(createPkg.publishConfig?.access).toBe("public");
    expect(createPkg.publishConfig?.tag).toBe("alpha");

    expect(workflow).toContain("id-token: write");
    expect(workflow).toContain("node-version: \"24\"");
    expect(workflow).not.toContain("registry-url: \"https://registry.npmjs.org\"");
    expect(workflow).toContain("uses: changesets/action@v1");
    expect(workflow).toContain("Create Release PR");
    expect(workflow).not.toContain("publish: npm run release");
    expect(workflow).toContain("Publish ForgeOS package");
    expect(workflow).toContain("id: forgeos-package");
    expect(workflow).toContain("node scripts/publish-npm-alpha-package.mjs .");
    expect(workflow).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(workflow).toContain("Generate release artifacts");
    expect(workflow).toContain("Security proof");
    expect(workflow).toContain("postgres:16");
    expect(workflow).toContain("DATABASE_URL: postgres://postgres:postgres@localhost:5432/forge_publish");
    expect(workflow).toContain("npm run forge -- security prove --db postgres --full --json");
    expect(workflow).toContain("npm run forge -- rls mutate-test --json");
    expect(workflow).toContain("npm run release:evidence");
    expect(workflow).toContain("node scripts/publish-npm-alpha-package.mjs packages/create-forge-app");
    expect(workflow).toContain("FORGE_ALLOW_FIRST_NPM_PUBLISH");
    expect(workflow).toContain("npm run release:verify-public-alpha");
    expect(workflow).toContain("--skip-create");
    expect(readFileSync(join(process.cwd(), "scripts", "publish-npm-alpha-package.mjs"), "utf8")).toContain(
      "--allow-first-publish",
    );
    expect(readFileSync(join(process.cwd(), "scripts", "publish-trusted-alpha.mjs"), "utf8")).toContain(
      "--allow-create-first-publish",
    );
    expect(readFileSync(join(process.cwd(), "scripts", "verify-public-alpha.mjs"), "utf8")).toContain(
      "--version-attempts=",
    );
    expect(readFileSync(join(process.cwd(), "scripts", "verify-public-alpha.mjs"), "utf8")).toContain(
      "forge-public-smoke-redacted",
    );
    expect(workflow).toContain("AI_GATEWAY_API_KEY: forge-ci-redacted-ai-gateway-key");
    expect(workflow).toContain("Regenerate release artifacts");
    expect(workflow).toContain("npm run forge -- generate");
    expect(workflow).toContain("git restore .");
    expect(workflow).toContain("git clean -fd");
    expect(workflow).toContain("NPM_CONFIG_PROVENANCE: \"true\"");
    expect(workflow).toContain("npm publish --access public --tag alpha");
    expect(workflow).toContain("npm run release:smoke");
    const forgeosPublishStart = workflow.indexOf("name: Publish ForgeOS package");
    const forgeosLatestStart = workflow.indexOf("name: Promote ForgeOS latest tag");
    const forgeosPublishBlock = workflow.slice(forgeosPublishStart, forgeosLatestStart);
    expect(forgeosPublishBlock).not.toContain("NPM_TOKEN");
    expect(forgeosPublishBlock).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).toContain("NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}");
    expect(workflow).toContain("NPM_TOKEN is not configured; skipping latest dist-tag promotion.");
    expect(workflow).toContain("npm dist-tag add \"forgeos@$(node -p \"require('./package.json').version\")\" latest");
  });
});
