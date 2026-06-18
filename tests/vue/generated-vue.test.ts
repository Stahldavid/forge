import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { cleanupWorkspace, scaffoldClientWorkspace } from "../client/helpers.ts";

describe("generated Vue entrypoint", () => {
  test("emits client-safe vue artifacts", async () => {
    const { root } = await scaffoldClientWorkspace("vue-generated");
    try {
      const vueTs = stripDeterministicHeader(
        readFileSync(join(root, GENERATED_DIR, "vue.ts"), "utf8"),
      );
      expect(vueTs).toContain('from "forge/vue"');
      expect(vueTs).toContain("./client.ts");
      expect(vueTs).toContain("useForgeLiveQuery");
      expect(vueTs).not.toContain("serverApi");
      expect(vueTs).not.toContain(".server");
      expect(vueTs).not.toContain("stripe");
      expect(vueTs).not.toContain("sentry");
      expect(vueTs).not.toContain("ai.server");

      const vueDts = readFileSync(join(root, GENERATED_DIR, "vue.d.ts"), "utf8");
      expect(vueDts).toContain("ForgeVuePluginOptions");
      expect(vueDts).toContain("useForgeLiveQuery");

      const clientManifest = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "clientManifest.json"), "utf8"),
        ),
      ) as {
        vue: { entrypoint: string; composables: string[] };
      };
      expect(clientManifest.vue.entrypoint).toBe("src/forge/_generated/vue.ts");
      expect(clientManifest.vue.composables).toContain("useForgeCommand");

      const manifest = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, GENERATED_DIR, "vueManifest.json"), "utf8"),
        ),
      ) as {
        composables: string[];
        clientSafe: boolean;
        commands: string[];
      };
      expect(manifest.clientSafe).toBe(true);
      expect(manifest.composables).toContain("useForgeLiveQuery");
      expect(manifest.commands).toContain("createTicket");
    } finally {
      cleanupWorkspace(root);
    }
  }, 30_000);
});
