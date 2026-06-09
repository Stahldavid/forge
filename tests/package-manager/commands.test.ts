import { describe, expect, test } from "bun:test";
import { buildAddCommand } from "../../src/forge/compiler/package-manager/commands.ts";

describe("buildAddCommand", () => {
  test("includes --ignore-scripts for all PMs when ignoreScripts is true", () => {
    for (const pm of ["bun", "npm", "pnpm", "yarn"] as const) {
      const argv = buildAddCommand(pm, "lodash", { ignoreScripts: true });
      expect(argv).toContain("--ignore-scripts");
    }
  });

  test("omits --ignore-scripts when ignoreScripts is false (--allow-scripts opt-in)", () => {
    for (const pm of ["bun", "npm", "pnpm", "yarn"] as const) {
      const argv = buildAddCommand(pm, "lodash", { ignoreScripts: false });
      expect(argv).not.toContain("--ignore-scripts");
    }
  });

  test("builds bun add argv", () => {
    expect(buildAddCommand("bun", "zod@3", { ignoreScripts: true })).toEqual([
      "bun",
      "add",
      "zod@3",
      "--ignore-scripts",
    ]);
  });

  test("builds npm install argv", () => {
    expect(buildAddCommand("npm", "zod@3", { ignoreScripts: true })).toEqual([
      "npm",
      "install",
      "zod@3",
      "--save",
      "--no-fund",
      "--no-audit",
      "--ignore-scripts",
    ]);
  });

  test("builds pnpm add argv", () => {
    expect(buildAddCommand("pnpm", "zod@3", { ignoreScripts: false })).toEqual([
      "pnpm",
      "add",
      "zod@3",
    ]);
  });

  test("builds yarn add argv", () => {
    expect(buildAddCommand("yarn", "zod@3", { ignoreScripts: true })).toEqual([
      "yarn",
      "add",
      "zod@3",
      "--ignore-scripts",
    ]);
  });
});
