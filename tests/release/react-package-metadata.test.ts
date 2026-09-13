import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("ForgeOS package metadata", () => {
  test("public React TypeScript export ships React declarations to consumers", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      exports?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.exports?.["./react"]).toBe("./src/forge/react/index.ts");
    expect(packageJson.dependencies?.["react"]).toBeTruthy();
    expect(packageJson.dependencies?.["@types/react"]).toBeTruthy();
    expect(packageJson.devDependencies?.["@types/react"]).toBeUndefined();
  });
});
