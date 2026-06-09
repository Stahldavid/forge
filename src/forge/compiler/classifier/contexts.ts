import type { CapabilitySet } from "../types/capability.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import {
  DETERMINISTIC_CONTEXTS,
  RUNTIME_CONTEXTS,
} from "../types/runtime.ts";
import type { PackageSignals } from "./signals.ts";
import { packageRecipeFor } from "../recipes/registry.ts";

export interface ContextVerdict {
  ok: boolean;
  reason: string;
}

export function hasUnknownCapability(caps: CapabilitySet): boolean {
  return (
    caps.network.status === "unknown" ||
    caps.filesystem.status === "unknown" ||
    caps.process.status === "unknown"
  );
}

export function hasNetworkEgress(caps: CapabilitySet): boolean {
  return caps.network.status === "required";
}

export function evaluateContext(
  context: RuntimeContext,
  recipe: IntegrationRecipe | undefined,
  caps: CapabilitySet,
  signals: PackageSignals,
  packageName: string,
): ContextVerdict {
  const pkgRecipe = recipe ? packageRecipeFor(recipe, packageName) : undefined;
  const denied = pkgRecipe?.contexts?.denied ?? recipe?.contexts.denied ?? [];
  const allowed = pkgRecipe?.contexts?.allowed ?? recipe?.contexts.allowed ?? [];

  if (denied.includes(context)) {
    return { ok: false, reason: "denied by integration recipe" };
  }

  if (
    (DETERMINISTIC_CONTEXTS as readonly RuntimeContext[]).includes(context) &&
    hasUnknownCapability(caps)
  ) {
    return {
      ok: false,
      reason:
        "capability is `unknown`; cannot prove determinism (static analysis cannot prove absence of network/fs)",
    };
  }

  if (
    (DETERMINISTIC_CONTEXTS as readonly RuntimeContext[]).includes(context) &&
    hasNetworkEgress(caps)
  ) {
    return {
      ok: false,
      reason: "uses network; commands must be deterministic",
    };
  }

  if (allowed.includes(context)) {
    return { ok: true, reason: "allowed by integration recipe" };
  }

  if (recipe) {
    return {
      ok: false,
      reason: "not in integration recipe allowed contexts",
    };
  }

  return evaluateHeuristicContext(context, caps, signals);
}

function evaluateHeuristicContext(
  context: RuntimeContext,
  caps: CapabilitySet,
  signals: PackageSignals,
): ContextVerdict {
  if (context === "shared") {
    if (
      hasNetworkEgress(caps) ||
      caps.filesystem.status === "required" ||
      caps.process.status === "required"
    ) {
      return {
        ok: false,
        reason: "shared context requires pure code without network/fs/process",
      };
    }
    if (hasUnknownCapability(caps)) {
      return {
        ok: false,
        reason: "insufficient signals to prove shared-safe purity",
      };
    }
    return { ok: true, reason: "no network/fs/process signals detected" };
  }

  if (context === "client") {
    if (caps.process.status === "required" || signals.usesNodeBuiltins) {
      return { ok: false, reason: "node builtins/process not allowed in client" };
    }
    if (hasNetworkEgress(caps)) {
      return { ok: true, reason: "client may perform network egress" };
    }
    if (hasUnknownCapability(caps)) {
      return { ok: false, reason: "insufficient signals for client compatibility" };
    }
    return { ok: true, reason: "no server-only signals detected" };
  }

  if (
    context === "server" ||
    context === "action" ||
    context === "workflow" ||
    context === "endpoint"
  ) {
    return { ok: true, reason: "server-side context allows IO capabilities" };
  }

  if (
    (DETERMINISTIC_CONTEXTS as readonly RuntimeContext[]).includes(context)
  ) {
    if (hasNetworkEgress(caps)) {
      return { ok: false, reason: "uses network; deterministic contexts forbid egress" };
    }
    if (hasUnknownCapability(caps)) {
      return {
        ok: false,
        reason: "unknown capability blocks deterministic context",
      };
    }
    if (caps.filesystem.status === "required" || caps.process.status === "required") {
      return {
        ok: false,
        reason: "filesystem/process access incompatible with deterministic context",
      };
    }
    return { ok: true, reason: "no blocking capabilities for deterministic context" };
  }

  if (context === "edge") {
    if (caps.process.status === "required") {
      return { ok: false, reason: "process access incompatible with edge runtime" };
    }
    return { ok: true, reason: "edge-compatible by heuristic" };
  }

  if (context === "test" || context === "build") {
    return { ok: true, reason: "test/build contexts allow broad compatibility" };
  }

  return {
    ok: false,
    reason: "insufficient signals; defaulting to incompatible",
  };
}

export function partitionContexts(
  recipe: IntegrationRecipe | undefined,
  caps: CapabilitySet,
  signals: PackageSignals,
  packageName: string,
): {
  compatible: RuntimeContext[];
  incompatible: RuntimeContext[];
  rationale: Record<RuntimeContext, string>;
} {
  const compatible: RuntimeContext[] = [];
  const incompatible: RuntimeContext[] = [];
  const rationale = {} as Record<RuntimeContext, string>;

  for (const context of RUNTIME_CONTEXTS) {
    const verdict = evaluateContext(context, recipe, caps, signals, packageName);
    rationale[context] = verdict.reason;
    if (verdict.ok) {
      compatible.push(context);
    } else {
      incompatible.push(context);
    }
  }

  return { compatible, incompatible, rationale };
}
