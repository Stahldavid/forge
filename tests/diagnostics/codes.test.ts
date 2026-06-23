import { describe, expect, test } from "bun:test";
import {
  DIAGNOSTIC_CODES,
  FORGE_DRIFT,
  FORGE_DUP_SYMBOL,
  FORGE_GUARD_VIOLATION,
  FORGE_ORPHANED_GENERATED_FILE,
  FORGE_PKG_NO_TYPES,
  FORGE_SANDBOX_LIMIT,
  FORGE_SANDBOX_ABNORMAL,
  FORGE_SECRET_LEAK,
  FORGE_AI_FORBIDDEN_CONTEXT,
  FORGE_AI_PROVIDER_UNKNOWN,
  FORGE_AI_MODEL_MISSING,
  FORGE_AI_SECRET_MISSING,
  FORGE_AI_DYNAMIC_PROVIDER,
  FORGE_AI_GENERATION_FAILED,
  FORGE_AI_USAGE_UNAVAILABLE,
  FORGE_RELEASE_PACKAGE_PACK_FAILED,
  FORGE_VERIFY_NO_TESTS_SELECTED,
  forgeDrift,
  forgeDupSymbol,
  forgeGuardViolation,
  forgeOrphanedGeneratedFile,
  forgePkgNoTypes,
  forgeSandboxLimit,
  forgeSandboxAbnormal,
  forgeSecretLeak,
} from "../../src/forge/compiler/diagnostics/index.ts";

describe("diagnostic codes catalog", () => {
  test("includes core and H12 AI codes", () => {
    for (const code of [
      FORGE_DUP_SYMBOL,
      FORGE_DRIFT,
      FORGE_GUARD_VIOLATION,
      FORGE_AI_FORBIDDEN_CONTEXT,
      FORGE_AI_PROVIDER_UNKNOWN,
      FORGE_AI_MODEL_MISSING,
      FORGE_AI_SECRET_MISSING,
      FORGE_AI_DYNAMIC_PROVIDER,
      FORGE_AI_GENERATION_FAILED,
      FORGE_AI_USAGE_UNAVAILABLE,
      FORGE_RELEASE_PACKAGE_PACK_FAILED,
      FORGE_VERIFY_NO_TESTS_SELECTED,
    ]) {
      expect(DIAGNOSTIC_CODES).toContain(code);
    }

    expect(new Set(DIAGNOSTIC_CODES).size).toBe(DIAGNOSTIC_CODES.length);
  });

  test("factory helpers emit expected codes and severities", () => {
    expect(forgeDupSymbol("foo", "src/a.ts").code).toBe(FORGE_DUP_SYMBOL);
    expect(forgeDupSymbol("foo", "src/a.ts").severity).toBe("warning");

    expect(forgeDrift("src/forge/_generated/x.ts").code).toBe(FORGE_DRIFT);
    expect(forgeDrift("src/forge/_generated/x.ts").severity).toBe("warning");

    expect(forgePkgNoTypes("stripe", ".").code).toBe(FORGE_PKG_NO_TYPES);

    const guard = forgeGuardViolation(
      "stripe",
      "command",
      "network egress",
      "src/cmd.ts",
      { start: 0, end: 10 },
    );
    expect(guard.code).toBe(FORGE_GUARD_VIOLATION);
    expect(guard.severity).toBe("error");
    expect(guard.fixHint).toContain("Move 'stripe' usage");
    expect(guard.suggestedCommands?.some((command) => command.includes("forge refactor extract-action"))).toBe(true);

    expect(forgeSandboxLimit("ai").code).toBe(FORGE_SANDBOX_LIMIT);
    expect(forgeSandboxAbnormal("stripe").code).toBe(FORGE_SANDBOX_ABNORMAL);
    expect(forgeSandboxAbnormal("stripe").severity).toBe("warning");
    expect(forgeSecretLeak().code).toBe(FORGE_SECRET_LEAK);
    expect(forgeSecretLeak().severity).toBe("error");

    const orphan = forgeOrphanedGeneratedFile("src/forge/_generated/old.ts");
    expect(orphan.code).toBe(FORGE_ORPHANED_GENERATED_FILE);
    expect(orphan.severity).toBe("error");
  });
});
