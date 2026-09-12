import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashTsconfigForWorkspace } from "../../src/forge/compiler/app-graph/tsconfig-hash.ts";

function tempWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${label}-`));
}

describe("compiler cross-platform determinism", () => {
  test("pins TypeScript sources and generated state to LF", () => {
    const attributes = readFileSync(resolve(process.cwd(), ".gitattributes"), "utf8");
    expect(attributes).toContain("*.ts text eol=lf");
    expect(attributes).toContain("*.tsx text eol=lf");
    expect(attributes).toContain("AGENTS.md text eol=lf");
    expect(attributes).toContain("forge.lock text eol=lf");
    expect(attributes).toContain("src/forge/_generated/** text eol=lf");
  });

  test("hashes equivalent tsconfig paths independently of workspace location", () => {
    const workspaceA = tempWorkspace("tsconfig-a");
    const workspaceB = tempWorkspace("tsconfig-b");
    const config = {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        rootDir: ".",
        baseUrl: ".",
        outDir: "dist",
        paths: {
          "@app/*": ["src/*"],
        },
      },
      include: ["src/**/*"],
    };

    try {
      writeFileSync(join(workspaceA, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
      writeFileSync(join(workspaceB, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");

      const hashA = hashTsconfigForWorkspace(workspaceA);
      const hashB = hashTsconfigForWorkspace(workspaceB);
      expect(hashB).toBe(hashA);

      writeFileSync(
        join(workspaceB, "tsconfig.json"),
        `${JSON.stringify({
          ...config,
          compilerOptions: {
            ...config.compilerOptions,
            rootDir: "src",
          },
        }, null, 2)}\n`,
        "utf8",
      );
      expect(hashTsconfigForWorkspace(workspaceB)).not.toBe(hashA);
    } finally {
      rmSync(workspaceA, { recursive: true, force: true });
      rmSync(workspaceB, { recursive: true, force: true });
    }
  });
});
