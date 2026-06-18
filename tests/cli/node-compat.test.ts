import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  nodeForgeSpawnEnv,
  runNodeForge,
  TSX_CLI_CACHE_DIR,
} from "./node-compat-helpers.ts";

describe("Node-compatible CLI", () => {
  test("root Forge scripts use the Node bootstrap by default", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.forge).toBe("node ./bin/forge.mjs");
    expect(pkg.scripts?.test).toBe("node ./bin/forge-bun.mjs test --timeout 120000");
    expect(pkg.scripts?.["forge:check"]).toBe("node ./bin/forge.mjs check");
    expect(pkg.scripts?.["forge:generate"]).toBe("node ./bin/forge.mjs generate");
    expect(pkg.scripts?.["forge:generate:check"]).toBe(
      "node ./bin/forge.mjs generate --check",
    );
    expect(pkg.scripts?.["forge:bun"]).toBe("node ./bin/forge-bun.mjs src/forge/cli/main.ts");
    expect(pkg.scripts?.verify).toBe("node ./bin/forge.mjs verify");
    expect(pkg.scripts?.lint).toBe("node --import tsx ./src/forge/cli/lint-forge.ts");
    expect(existsSync(join(process.cwd(), "bin", "forge-bun.mjs"))).toBe(true);
  });

  test("node bin executes the Forge CLI under Node", async () => {
    const result = await runNodeForge(["--version", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).forgeosVersion).toMatch(/^0\./);
  });

  test("node CLI subprocesses use a stable repo-local tsx cache", () => {
    const env = nodeForgeSpawnEnv();
    const expected = join(process.cwd(), "node_modules", ".cache", "forge-tsx-cli");

    expect(TSX_CLI_CACHE_DIR).toBe(expected);
    expect(env.TMP).toBe(expected);
    expect(env.TEMP).toBe(expected);
    expect(env.TMPDIR).toBe(expected);
  });
});
