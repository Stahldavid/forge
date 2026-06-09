import { describe, expect, test } from "bun:test";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { FORGE_SECRET_FORBIDDEN_CONTEXT } from "../../src/forge/compiler/diagnostics/codes.ts";

describe("forbidden secrets context", () => {
  test("command context forbids ctx.secrets.get", () => {
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => "value",
        snapshot: () => ({}),
      },
      registryNames: new Set(["STRIPE_SECRET_KEY"]),
      runtimeKind: "command",
    });

    expect(() => secrets.get("STRIPE_SECRET_KEY")).toThrow();
    try {
      secrets.get("STRIPE_SECRET_KEY");
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe(FORGE_SECRET_FORBIDDEN_CONTEXT);
    }

    expect(secrets.optional("STRIPE_SECRET_KEY")).toBeUndefined();
    expect(secrets.has("STRIPE_SECRET_KEY")).toBe(false);
  });
});
