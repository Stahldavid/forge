import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import { runReleaseCommand } from "../../src/forge/cli/release.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function writeSourcemapFixture(workspace: string): string {
  const dist = join(workspace, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, "app.js"), "function min(){throw new Error('x')}\n", "utf8");
  writeFileSync(
    join(dist, "app.js.map"),
    JSON.stringify({
      version: 3,
      file: "dist/app.js",
      sources: ["src/app.ts"],
      names: ["TicketsPage"],
      mappings: "AAAAA",
    }),
    "utf8",
  );
  const input = join(workspace, "stacktrace.json");
  writeFileSync(
    input,
    JSON.stringify({ frames: [{ file: "dist/app.js", line: 1, column: 0 }] }),
    "utf8",
  );
  return input;
}

describe("H23 release artifacts and symbolication", () => {
  test("generates release manifests deterministically", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-generated");
    try {
      const result = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      for (const file of [
        "releaseManifest.json",
        "deployManifest.json",
        "artifactManifest.json",
        "sourceMapManifest.json",
        "symbolicationManifest.json",
        "buildInfo.json",
      ]) {
        expect(existsSync(join(workspace, "src", "forge", "_generated", file))).toBe(true);
      }

      const release = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(workspace, "src", "forge", "_generated", "releaseManifest.json"), "utf8"),
        ),
      ) as { defaultProvider: string; optionalProviders: string[] };
      expect(release.defaultProvider).toBe("local");
      expect(release.optionalProviders).toContain("sentry");
      expect(release.optionalProviders).toContain("bugsink");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("prepare stores local release artifacts and symbolicates stacktrace", async () => {
    const workspace = scaffoldGenerateWorkspace("h23-symbolicate");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const input = writeSourcemapFixture(workspace);

      const prepared = await runReleaseCommand({
        area: "release",
        action: "prepare",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(prepared.exitCode).toBe(0);

      const symbolicated = await runReleaseCommand({
        area: "sourcemaps",
        action: "symbolicate",
        workspaceRoot: workspace,
        json: true,
        env: "production",
        input,
        allowDirty: true,
        allowPublicSourcemaps: false,
      });
      expect(symbolicated.exitCode).toBe(0);
      const frame = (symbolicated.data as { frames: Array<{ original?: { source: string; name?: string } }> }).frames[0];
      expect(frame.original?.source).toBe("src/app.ts");
      expect(frame.original?.name).toBe("TicketsPage");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
