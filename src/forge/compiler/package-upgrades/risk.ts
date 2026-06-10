import {
  FORGE_DEPS_API_BREAKING_CHANGE,
  FORGE_DEPS_CAPABILITY_ADDED,
  FORGE_DEPS_REMOVED_EXPORT_USED,
  FORGE_DEPS_RUNTIME_CONTEXT_CHANGED,
  FORGE_DEPS_SECRET_ADDED,
  FORGE_DEPS_SIGNATURE_CHANGED_USED,
} from "../diagnostics/codes.ts";
import type {
  PackageApiDiff,
  RiskLevel,
  RiskReason,
  RuntimeDiff,
  UpgradeImpact,
  UpgradeRiskReport,
} from "./types.ts";

export function semverBump(from: string, to: string): "patch" | "minor" | "major" | "prerelease" | "unknown" {
  const before = parseSemver(from);
  const after = parseSemver(to);
  if (!before || !after) {
    return "unknown";
  }
  if (after.prerelease || before.prerelease) {
    return "prerelease";
  }
  if (after.major !== before.major) {
    return "major";
  }
  if (after.minor !== before.minor) {
    return "minor";
  }
  if (after.patch !== before.patch) {
    return "patch";
  }
  return "patch";
}

function parseSemver(version: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
} | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: Boolean(match[4]),
  };
}

function levelFromScore(score: number): RiskLevel {
  if (score > 100) {
    return "critical";
  }
  if (score >= 65) {
    return "high";
  }
  if (score >= 35) {
    return "medium";
  }
  return "low";
}

function baseRiskForBump(bump: ReturnType<typeof semverBump>): {
  score: number;
  reason: RiskReason;
} {
  switch (bump) {
    case "patch":
      return {
        score: 15,
        reason: { code: "FORGE_DEPS_SEMVER_PATCH", severity: "info", message: "patch version upgrade" },
      };
    case "minor":
      return {
        score: 35,
        reason: { code: "FORGE_DEPS_SEMVER_MINOR", severity: "warning", message: "minor version upgrade" },
      };
    case "major":
      return {
        score: 60,
        reason: { code: "FORGE_DEPS_SEMVER_MAJOR", severity: "warning", message: "major version upgrade" },
      };
    case "prerelease":
      return {
        score: 60,
        reason: { code: "FORGE_DEPS_SEMVER_PRERELEASE", severity: "warning", message: "pre-release upgrade" },
      };
    default:
      return {
        score: 55,
        reason: { code: "FORGE_DEPS_SEMVER_UNKNOWN", severity: "warning", message: "could not classify semver jump" },
      };
  }
}

export function buildRiskReport(input: {
  bump: ReturnType<typeof semverBump>;
  apiDiff: PackageApiDiff;
  runtimeDiff: RuntimeDiff;
  affected: UpgradeImpact;
}): UpgradeRiskReport {
  const base = baseRiskForBump(input.bump);
  let score = base.score;
  const reasons: RiskReason[] = [base.reason];

  if (input.apiDiff.removedExports.length > 0) {
    score += input.affected.files.length > 0 ? 25 : 15;
    reasons.push({
      code: input.affected.files.length > 0
        ? FORGE_DEPS_REMOVED_EXPORT_USED
        : FORGE_DEPS_API_BREAKING_CHANGE,
      severity: "error",
      message: `${input.apiDiff.removedExports.length} exports were removed`,
    });
  }

  if (input.apiDiff.changedSignatures.length > 0) {
    score += input.affected.files.length > 0 ? 20 : 10;
    reasons.push({
      code: input.affected.files.length > 0
        ? FORGE_DEPS_SIGNATURE_CHANGED_USED
        : FORGE_DEPS_API_BREAKING_CHANGE,
      severity: "warning",
      message: `${input.apiDiff.changedSignatures.length} exported signatures changed`,
    });
  }

  if (input.runtimeDiff.contextCompatibilityChanged) {
    score += 20;
    reasons.push({
      code: FORGE_DEPS_RUNTIME_CONTEXT_CHANGED,
      severity: "error",
      message: "runtime context compatibility changed",
    });
  }

  if (input.runtimeDiff.secretChanges.added.length > 0) {
    score += 15;
    reasons.push({
      code: FORGE_DEPS_SECRET_ADDED,
      severity: "warning",
      message: `new secrets required: ${input.runtimeDiff.secretChanges.added.join(", ")}`,
    });
  }

  if (input.runtimeDiff.addedCapabilities.length > 0) {
    score += 15;
    reasons.push({
      code: FORGE_DEPS_CAPABILITY_ADDED,
      severity: "warning",
      message: `new capabilities detected: ${input.runtimeDiff.addedCapabilities.map((capability) => capability.name).join(", ")}`,
    });
  }

  if (input.affected.generatedAdapters.length > 0) {
    score += 10;
    reasons.push({
      code: "FORGE_DEPS_GENERATED_ADAPTER_IMPACTED",
      severity: "warning",
      message: "generated integration adapters are affected",
    });
  }

  if (
    input.affected.commands.length > 0 ||
    input.affected.queries.length > 0 ||
    input.affected.liveQueries.length > 0
  ) {
    score += 15;
    reasons.push({
      code: "FORGE_DEPS_BOUNDARY_IMPACTED",
      severity: "warning",
      message: "upgrade affects command/query/liveQuery boundaries",
    });
  }

  const blockers = reasons
    .filter((reason) => reason.severity === "error")
    .map((reason) => ({
      code: reason.code,
      message: reason.message,
      recommendedAction: "Inspect affected files and run forge verify --strict before applying.",
    }));

  return {
    level: levelFromScore(Math.min(100, score)),
    score: Math.min(100, score),
    reasons,
    blockers,
  };
}

export function recommendedCommands(impact: UpgradeImpact): string[] {
  return [
    "forge generate",
    "forge check",
    "forge verify --strict",
    ...impact.tests.map((test) => `bun test ${test}`),
  ];
}
