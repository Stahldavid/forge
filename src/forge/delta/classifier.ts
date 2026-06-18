import { extname } from "node:path";
import { normalizePath } from "../compiler/primitives/paths.ts";

export interface DeltaSemanticHint {
  kind: string;
  confidence: "high" | "medium" | "low";
}

export function classifyDeltaPath(path: string): DeltaSemanticHint[] {
  const normalized = normalizePath(path);
  const hints: DeltaSemanticHint[] = [];

  if (normalized.startsWith("src/forge/_generated/")) {
    hints.push({ kind: "artifact.generated", confidence: "high" });
  } else if (normalized === "src/policies.ts" || normalized.includes("/policies/")) {
    hints.push({ kind: "policy.change", confidence: "high" });
  } else if (normalized.startsWith("src/commands/")) {
    hints.push({ kind: "command.change", confidence: "high" });
  } else if (normalized.startsWith("src/queries/")) {
    hints.push({ kind: "query.change", confidence: "high" });
  } else if (normalized.startsWith("src/actions/")) {
    hints.push({ kind: "action.change", confidence: "high" });
  } else if (normalized.startsWith("src/workflows/")) {
    hints.push({ kind: "workflow.change", confidence: "high" });
  } else if (normalized === "src/forge/schema.ts") {
    hints.push({ kind: "schema.change", confidence: "high" });
  } else if (normalized.endsWith(".manifest.json") || normalized === "forge.manifest.json") {
    hints.push({ kind: "manifest.change", confidence: "high" });
  } else if (normalized === "package.json" || normalized.endsWith("/package.json")) {
    hints.push({ kind: "dependency.change", confidence: "medium" });
  }

  if (hints.length === 0) {
    hints.push({ kind: `file.${extname(normalized).slice(1) || "unknown"}`, confidence: "low" });
  }
  return hints;
}

export function classifyArtifactKind(path: string): string {
  const normalized = normalizePath(path);
  if (normalized.startsWith("src/forge/_generated/")) {
    return "generated-contract";
  }
  if (normalized.includes("security") || normalized.includes("proof")) {
    return "evidence";
  }
  if (normalized.startsWith(".forge/")) {
    return "local-state";
  }
  return "source";
}

