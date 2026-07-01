import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

describe("field-test script", () => {
  test("prints a dry-run matrix without creating apps", () => {
    const result = spawnSync(
      process.execPath,
      [
        "scripts/field-test-forgeos.mjs",
        "--dry-run",
        "--json",
        "--package-managers",
        "npm,pnpm",
        "--templates",
        "minimal-web,nuxt-web,b2b-support-web,vendor-access",
        "--forge-spec",
        "npm:forgeos@alpha",
        "--runtime-probes",
        "--auth-probes",
        "--ui-probes",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      authProbes: boolean;
      cases: Array<{ packageManager: string; template: string }>;
      forgeSpec: string;
      ok: boolean;
      runtimeProbes: boolean;
      uiProbes: boolean;
    };
    expect(payload.ok).toBe(true);
    expect(payload.forgeSpec).toBe("npm:forgeos@alpha");
    expect(payload.runtimeProbes).toBe(true);
    expect(payload.authProbes).toBe(true);
    expect(payload.uiProbes).toBe(true);
    expect(payload.cases).toHaveLength(8);
    expect(payload.cases).toContainEqual({ packageManager: "npm", template: "minimal-web" });
    expect(payload.cases).toContainEqual({ packageManager: "npm", template: "nuxt-web" });
    expect(payload.cases).toContainEqual({ packageManager: "pnpm", template: "b2b-support-web" });
    expect(payload.cases).toContainEqual({ packageManager: "npm", template: "vendor-access" });
  });

  test("runtime probes rely on forge dev ephemeral ports instead of pre-reserving ports", () => {
    const source = readFileSync("scripts/field-test-forgeos.mjs", "utf8");

    expect(source).not.toContain("createServer");
    expect(source).not.toContain("function getFreePort");
    expect(source).toContain('["--web-port", "0"]');
    expect(source).toContain('"--skip-startup-console"');
    expect(source).toContain("waitForDevStartup");
  });

  test("vendor-access probes verify root organization tenant isolation", () => {
    const source = readFileSync("scripts/field-test-forgeos.mjs", "utf8");

    expect(source).toContain('resultRows(acmeDashboard, "organizations")');
    expect(source).toContain('resultRows(globexDashboard, "organizations")');
    expect(source).toContain('organization.id === VENDOR_ACCESS_TENANTS.acme');
    expect(source).toContain('organization.id === VENDOR_ACCESS_TENANTS.globex');
    expect(source).toContain('organization.name === "Acme Corp"');
    expect(source).toContain('organization.name === "Globex Security"');
  });

  test("UI probes reject obvious broken first-screen copy", () => {
    const source = readFileSync("scripts/field-test-forgeos.mjs", "utf8");

    expect(source).toContain("function visibleWebFailureCopy");
    expect(source).toContain("Failed to fetch");
    expect(source).toContain("No organization seeded");
    expect(source).toContain("FORGE_DEV_SERVER_ERROR");
  });
});
