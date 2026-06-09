import { describe, expect, test } from "bun:test";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { FORGE_SECRET_MISSING } from "../../src/forge/compiler/diagnostics/codes.ts";

describe("ctx secrets", () => {
  test("returns secret value from store", () => {
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: (name) => (name === "POSTHOG_KEY" ? "phc_test" : undefined),
        snapshot: () => ({}),
      },
      registryNames: new Set(["POSTHOG_KEY"]),
      runtimeKind: "action",
    });

    expect(secrets.get("POSTHOG_KEY")).toBe("phc_test");
    expect(secrets.has("POSTHOG_KEY")).toBe(true);
  });

  test("throws FORGE_SECRET_MISSING for required secret", () => {
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => undefined,
        snapshot: () => ({}),
      },
      registryNames: new Set(["POSTHOG_KEY"]),
      runtimeKind: "action",
      requiredSecrets: [{ name: "POSTHOG_KEY", required: true }],
    });

    expect(() => secrets.get("POSTHOG_KEY")).toThrow();
    try {
      secrets.get("POSTHOG_KEY");
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe(FORGE_SECRET_MISSING);
    }
  });
});
