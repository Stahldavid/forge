import { stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";

export const LOCAL_ADAPTIVE_EXTENSION_KEY = "local-adaptive-input-profile";
const HARNESS_INPUT_LIMIT = 256;
const LABEL = /^[a-z][a-z0-9-]{0,23}$/u;

export interface LocalAdaptiveInputRule {
  maxLength: number;
  requiredLabel: string;
}

/** Data-only restrictions on the two fixed local adaptive worker inputs. */
export interface LocalAdaptiveInputProfile {
  schemaVersion: 1;
  kind: "local-adaptive-input-profile";
  inventory: LocalAdaptiveInputRule;
  constraints: LocalAdaptiveInputRule;
}

function invalid(message: string): never {
  throw new AgentFabricError("AF_INVALID_STATE", message);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validRule(value: unknown): value is LocalAdaptiveInputRule {
  if (!exactKeys(value, ["maxLength", "requiredLabel"])) return false;
  const label = value.requiredLabel;
  return typeof label === "string" && LABEL.test(label) &&
    Number.isSafeInteger(value.maxLength) &&
    (value.maxLength as number) >= label.length + 3 &&
    (value.maxLength as number) <= HARNESS_INPUT_LIMIT;
}

/** Require one canonical UTF-8 JSON document; duplicate/unknown keys and code are excluded. */
export function parseLocalAdaptiveInputProfile(bytes: Buffer): LocalAdaptiveInputProfile {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 1024) {
    invalid("Local adaptive profile size is invalid");
  }
  let value: unknown;
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { invalid("Local adaptive profile is not UTF-8"); }
  try { value = JSON.parse(raw); } catch { invalid("Local adaptive profile is invalid JSON"); }
  if (!exactKeys(value, ["schemaVersion", "kind", "inventory", "constraints"]) ||
      value.schemaVersion !== 1 || value.kind !== "local-adaptive-input-profile" ||
      !validRule(value.inventory) || !validRule(value.constraints) ||
      raw !== `${stableStringify(value)}\n`) {
    invalid("Local adaptive profile is outside the v1 data contract");
  }
  return value as unknown as LocalAdaptiveInputProfile;
}

export function acceptsLocalAdaptiveInput(rule: LocalAdaptiveInputRule, value: string): boolean {
  return typeof value === "string" && value.length <= rule.maxLength &&
    value.startsWith(`${rule.requiredLabel}:`) &&
    value.length > rule.requiredLabel.length + 1;
}

export function assertLocalAdaptiveInputs(profile: LocalAdaptiveInputProfile,
  inventory: string, constraints: string): void {
  if (!acceptsLocalAdaptiveInput(profile.inventory, inventory) ||
      !acceptsLocalAdaptiveInput(profile.constraints, constraints)) {
    invalid("Local adaptive inputs do not satisfy the selected data profile");
  }
}

/** Fixed behavioral probes are evaluated without running artifact code or worker code. */
export function evaluateLocalAdaptiveProfile(bytes: Buffer): {
  contract: boolean; acceptsValid: boolean; rejectsWrongLabel: boolean; rejectsOverLimit: boolean;
} {
  let profile: LocalAdaptiveInputProfile;
  try { profile = parseLocalAdaptiveInputProfile(bytes); }
  catch { return { contract: false, acceptsValid: false, rejectsWrongLabel: false, rejectsOverLimit: false }; }
  const rules = [profile.inventory, profile.constraints];
  return {
    contract: true,
    acceptsValid: rules.every((rule) => acceptsLocalAdaptiveInput(rule, `${rule.requiredLabel}:x`)),
    rejectsWrongLabel: rules.every((rule) => !acceptsLocalAdaptiveInput(rule, `wrong:${rule.requiredLabel}:x`)),
    rejectsOverLimit: rules.every((rule) =>
      !acceptsLocalAdaptiveInput(rule, `${rule.requiredLabel}:${"x".repeat(rule.maxLength)}`)),
  };
}
