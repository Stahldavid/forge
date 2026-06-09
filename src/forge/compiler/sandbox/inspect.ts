import type { Diagnostic } from "../types/diagnostic.ts";
import type { SandboxLimits } from "../types/cli.ts";
import type { Dependency } from "../types/package-graph.ts";
import {
  forgeSandboxAbnormal,
  forgeSandboxLimit,
  forgeSecretLeak,
} from "../diagnostics/create.ts";
import { getChildRunner } from "./backends/child.ts";
import { getDockerRunner } from "./backends/docker.ts";
import { clampSandboxLimits } from "./limits.ts";
import { scrubEnv, type ScrubEnvOptions } from "./scrub-env.ts";
import { secretLeakScan } from "./secret-scan.ts";
import {
  assertJsonSerializable,
  parseRuntimeExportShape,
  serializeRuntimeExportShape,
} from "./serialize.ts";
import {
  emptyRuntimeExportShape,
  type RuntimeExportShape,
} from "./types.ts";

export interface SandboxInspectOptions extends ScrubEnvOptions {
  knownSecretValues?: Iterable<string>;
}

export interface SandboxInspectResult {
  shape: RuntimeExportShape;
  diagnostics: Diagnostic[];
  runtimeUsed: boolean;
}

interface BackendRunOutcome {
  stdout: string;
  timedOut: boolean;
  oomKilled: boolean;
  startFailed: boolean;
  abnormalExit: boolean;
}

export async function inspectExports(
  dep: Dependency,
  limitsInput: SandboxLimits,
  options: SandboxInspectOptions = {},
): Promise<SandboxInspectResult> {
  const limits = clampSandboxLimits(limitsInput);
  const diagnostics: Diagnostic[] = [];

  if (limits.backend === "none") {
    return {
      shape: emptyRuntimeExportShape(),
      diagnostics,
      runtimeUsed: false,
    };
  }

  const scrubbedEnv = scrubEnv(process.env, options);

  let outcome: BackendRunOutcome;
  if (limits.backend === "docker") {
    const result = await getDockerRunner().run(dep, limits, scrubbedEnv);
    outcome = {
      stdout: result.stdout,
      timedOut: result.timedOut,
      oomKilled: result.oomKilled,
      startFailed: result.startFailed || result.dockerUnavailable,
      abnormalExit:
        result.exitCode !== 0 &&
        !result.timedOut &&
        !result.oomKilled &&
        !result.startFailed,
    };
  } else {
    const result = await getChildRunner().run(dep, limits, scrubbedEnv);
    outcome = {
      stdout: result.stdout,
      timedOut: result.timedOut,
      oomKilled: result.oomKilled,
      startFailed: result.startFailed,
      abnormalExit:
        result.exitCode !== 0 &&
        !result.timedOut &&
        !result.oomKilled &&
        !result.startFailed,
    };
  }

  if (outcome.timedOut || outcome.oomKilled) {
    diagnostics.push(forgeSandboxLimit(dep.name));
    return {
      shape: emptyRuntimeExportShape(),
      diagnostics,
      runtimeUsed: false,
    };
  }

  if (outcome.startFailed || outcome.abnormalExit) {
    diagnostics.push(
      forgeSandboxAbnormal(dep.name, "process exited abnormally"),
    );
    return {
      shape: emptyRuntimeExportShape(),
      diagnostics,
      runtimeUsed: false,
    };
  }

  let shape: RuntimeExportShape;
  try {
    shape = parseRuntimeExportShape(outcome.stdout.trim());
    assertJsonSerializable(shape);
  } catch {
    diagnostics.push(
      forgeSandboxAbnormal(dep.name, "invalid sandbox output"),
    );
    return {
      shape: emptyRuntimeExportShape(),
      diagnostics,
      runtimeUsed: false,
    };
  }

  const serialized = serializeRuntimeExportShape(shape);
  const leak = secretLeakScan(serialized, {
    knownSecretValues: options.knownSecretValues,
  });

  if (leak.hasLeak) {
    diagnostics.push(forgeSecretLeak());
    return {
      shape: emptyRuntimeExportShape(),
      diagnostics,
      runtimeUsed: false,
    };
  }

  return {
    shape,
    diagnostics,
    runtimeUsed: shape.entrypoints.some((ep) => ep.exports.length > 0),
  };
}
