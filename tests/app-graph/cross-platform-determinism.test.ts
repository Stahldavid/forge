import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { hashTsconfigForWorkspace } from "../../src/forge/compiler/app-graph/tsconfig-hash.ts";
import { walkWorkspaceSources } from "../../src/forge/compiler/orchestrator/workspace-index.ts";

function tempWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `forge-${label}-`));
}

describe("compiler cross-platform determinism", () => {
  test("normalizes source line endings before hashing and parsing", async () => {
    const workspace = tempWorkspace("source-eol");
    const sourceDir = join(workspace, "src");
    const sourcePath = join(sourceDir, "example.ts");
    const logicalSource = [
      "export class Example {",
      "  run(): number {",
      "    return 1;",
      "  }",
      "}",
      "",
    ].join("\n");

    try {
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(sourcePath, logicalSource.replace(/\n/g, "\r\n"), "utf8");
      const crlf = walkWorkspaceSources({ workspaceRoot: workspace, roots: ["src"] });
      expect(crlf.sources).toHaveLength(1);
      expect(crlf.sources[0]?.text).toBe(logicalSource);

      const crlfGraph = await buildAppGraph({
        workspaceRoot: workspace,
        sources: crlf.sources,
        tsconfigHash: "portable-tsconfig",
      });

      writeFileSync(sourcePath, logicalSource, "utf8");
      const lf = walkWorkspaceSources({ workspaceRoot: workspace, roots: ["src"] });
      expect(lf.sources).toHaveLength(1);
      expect(lf.sources[0]?.text).toBe(logicalSource);
      expect(lf.sources[0]?.contentHash).toBe(crlf.sources[0]?.contentHash);

      const lfGraph = await buildAppGraph({
        workspaceRoot: workspace,
        sources: lf.sources,
        tsconfigHash: "portable-tsconfig",
      });

      expect(lfGraph).toEqual(crlfGraph);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
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
