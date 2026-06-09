import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadEnvFiles } from "../../src/forge/runtime/secrets/env-loader.ts";

describe("env loader", () => {
  test("loads .env then .env.local with process.env precedence", () => {
    const root = mkdtempSync(join(tmpdir(), "forge-env-"));
    writeFileSync(join(root, ".env"), "FOO=from-env\nBAR=from-env\n", "utf8");
    writeFileSync(join(root, ".env.local"), "FOO=from-local\n", "utf8");

    const previousFoo = process.env.FOO;
    process.env.FOO = "from-process";

    try {
      const { store } = loadEnvFiles({ workspaceRoot: root });
      expect(store.loadedFiles).toEqual([".env", ".env.local"]);
      expect(store.resolve("FOO")).toBe("from-process");
      expect(store.resolve("BAR")).toBe("from-env");
    } finally {
      if (previousFoo === undefined) {
        delete process.env.FOO;
      } else {
        process.env.FOO = previousFoo;
      }
    }
  });
});
