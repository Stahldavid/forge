import { describe, expect, test } from "bun:test";
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
        "minimal-web,nuxt-web,b2b-support-web",
        "--forge-spec",
        "npm:forgeos@alpha",
        "--runtime-probes",
        "--auth-probes",
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
    };
    expect(payload.ok).toBe(true);
    expect(payload.forgeSpec).toBe("npm:forgeos@alpha");
    expect(payload.runtimeProbes).toBe(true);
    expect(payload.authProbes).toBe(true);
    expect(payload.cases).toHaveLength(6);
    expect(payload.cases).toContainEqual({ packageManager: "npm", template: "minimal-web" });
    expect(payload.cases).toContainEqual({ packageManager: "npm", template: "nuxt-web" });
    expect(payload.cases).toContainEqual({ packageManager: "pnpm", template: "b2b-support-web" });
  });
});
