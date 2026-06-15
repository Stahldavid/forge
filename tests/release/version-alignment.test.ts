import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLI_VERSION, FORGEOS_VERSION, GENERATOR_VERSION } from "../../src/forge/version.ts";
import { GENERATOR_VERSION as APP_GRAPH_GENERATOR_VERSION } from "../../src/forge/compiler/app-graph/versions.ts";
import { GENERATOR_VERSION as PACKAGE_GRAPH_GENERATOR_VERSION } from "../../src/forge/compiler/package-graph/constants.ts";

describe("release version alignment", () => {
  test("CLI and generated artifacts use the package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(FORGEOS_VERSION).toBe(pkg.version);
    expect(CLI_VERSION).toBe(pkg.version);
    expect(GENERATOR_VERSION).toBe(pkg.version);
    expect(APP_GRAPH_GENERATOR_VERSION).toBe(pkg.version);
    expect(PACKAGE_GRAPH_GENERATOR_VERSION).toBe(pkg.version);
  });
});
