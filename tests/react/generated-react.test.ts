import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldClientWorkspace } from "../client/helpers.ts";

describe("generated React entrypoint", () => {
  test("emits client-safe react artifacts", async () => {
    const { root } = await scaffoldClientWorkspace("react-generated");
    try {
      const reactTs = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "react.ts"), "utf8"),
      );
      expect(reactTs.startsWith('"use client";')).toBe(true);
      expect(reactTs).toContain('from "forge/react"');
      expect(reactTs).toContain("./client.ts");
      expect(reactTs).not.toContain("serverApi");
      expect(reactTs).not.toContain(".server");
      expect(reactTs).not.toContain("stripe");
      expect(reactTs).not.toContain("sentry");
      expect(reactTs).not.toContain("ai.server");

      const reactDts = readFileSync(join(root, GENERATED_DIR, "react.d.ts"), "utf8");
      expect(reactDts).toContain("ForgeProviderProps");
      expect(reactDts).toContain("useLiveQuery");

      const manifest = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "reactManifest.json"), "utf8"),
        ),
      ) as {
        hooks: string[];
        clientSafe: boolean;
        liveQueries: string[];
      };

      expect(manifest.clientSafe).toBe(true);
      expect(manifest.hooks).toContain("useLiveQuery");
      expect(manifest.liveQueries).toContain("watchUser");
    } finally {
      cleanupWorkspace(root);
    }
  }, 30_000);
});
