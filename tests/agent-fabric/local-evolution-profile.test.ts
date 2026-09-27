import { describe, expect, test } from "bun:test";
import { stableStringify } from "../../src/forge/agent-fabric/canonical.ts";
import { acceptsLocalAdaptiveInput, evaluateLocalAdaptiveProfile,
  parseLocalAdaptiveInputProfile } from "../../src/forge/agent-fabric/local-evolution-profile.ts";

function artifact(inventoryMaxLength = 48): Buffer {
  return Buffer.from(`${stableStringify({
    schemaVersion: 1, kind: "local-adaptive-input-profile",
    inventory: { requiredLabel: "source", maxLength: inventoryMaxLength },
    constraints: { requiredLabel: "limits", maxLength: 40 },
  })}\n`);
}

describe("fixed local adaptive data profile", () => {
  test("accepts only canonical versioned JSON with narrowing limits", () => {
    const profile = parseLocalAdaptiveInputProfile(artifact());
    expect(profile.inventory.maxLength).toBe(48);
    expect(acceptsLocalAdaptiveInput(profile.inventory, "source:repo")).toBe(true);
    expect(acceptsLocalAdaptiveInput(profile.inventory, "wrong:repo")).toBe(false);
    expect(acceptsLocalAdaptiveInput(profile.inventory, "source:")).toBe(false);
    expect(acceptsLocalAdaptiveInput(profile.inventory, `source:${"x".repeat(48)}`)).toBe(false);
    expect(() => parseLocalAdaptiveInputProfile(artifact(257))).toThrow("v1 data contract");
    expect(() => parseLocalAdaptiveInputProfile(Buffer.from(artifact().toString().trim())))
      .toThrow("v1 data contract");
    expect(() => parseLocalAdaptiveInputProfile(Buffer.from(
      artifact().toString().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'))))
      .toThrow("v1 data contract");
  });

  test("fixed behavioral cases reject executable and excessive artifacts", () => {
    expect(evaluateLocalAdaptiveProfile(artifact())).toEqual({
      contract: true, acceptsValid: true, rejectsWrongLabel: true, rejectsOverLimit: true,
    });
    expect(evaluateLocalAdaptiveProfile(Buffer.from("export default () => process.exit()"))).toEqual({
      contract: false, acceptsValid: false, rejectsWrongLabel: false, rejectsOverLimit: false,
    });
    expect(evaluateLocalAdaptiveProfile(artifact(257)).contract).toBe(false);
  });
});