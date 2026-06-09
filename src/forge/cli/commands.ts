import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { classify } from "../compiler/classifier/classify.ts";
import { buildRuntimeMatrix } from "../compiler/classifier/runtime-matrix.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { forgeAdd } from "../compiler/integration/add.ts";
import { checkImportGuards } from "../compiler/guards/check-import-guards.ts";
import { run } from "../compiler/orchestrator/run.ts";
import { discover } from "../compiler/orchestrator/discover.ts";
import { loadManifest } from "../compiler/orchestrator/manifest.ts";
import { resolveByPackageName } from "../compiler/recipes/registry.ts";
import { PackageGraphCompiler } from "../compiler/package-graph/compiler.ts";
import type {
  ForgeAddResult,
  GenerateOptions,
  GenerateResult,
  InspectResult,
  InspectTarget,
  VerifyOptions,
  VerifyResult,
} from "../compiler/types/cli.ts";
import type { RuntimeMatrix } from "../compiler/types/runtime-matrix.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import {
  attachFailureKind,
  buildAddJson,
  buildGenerateJson,
  buildInspectJson,
  formatJsonResult,
  writeHumanAdd,
  writeHumanGenerate,
  writeHumanInspect,
  buildVerifyJson,
  writeHumanVerify,
} from "./output.ts";
import type { ForgeCommand } from "./parse.ts";
import { runVerifyCommand } from "./verify.ts";
import {
  formatRunJson,
  formatRunListHuman,
  formatRunResultHuman,
  runRunCommand,
} from "./run.ts";
import { runDevCommand } from "./dev.ts";
import { formatDbHuman, formatDbJson, runDbCommand } from "./db.ts";
import { formatOutboxHuman, formatOutboxJson, runOutboxCommand } from "./outbox.ts";
import {
  formatWorkflowHuman,
  formatWorkflowJson,
  runWorkflowCommand,
} from "./workflow.ts";
import {
  formatTelemetryHuman,
  formatTelemetryJson,
  runTelemetryCommand,
} from "./telemetry.ts";
import {
  formatPolicyHuman,
  formatPolicyJson,
  runPolicyCommand,
} from "./policy.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

export async function runGenerateCommand(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const result = await run(options);
  return attachFailureKind(result);
}

export async function runAddCommand(
  alias: string,
  options: ForgeCommand extends { kind: "add" } ? ForgeCommand["options"] : never,
): Promise<ForgeAddResult> {
  const result = await forgeAdd(alias, options);
  return attachFailureKind(result);
}

async function loadRuntimeMatrixForCheck(
  workspaceRoot: string,
): Promise<RuntimeMatrix> {
  const fromDisk = readGeneratedJson<RuntimeMatrix>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeMatrix.json`,
  );
  if (fromDisk) {
    return fromDisk;
  }

  const ctx = discover({ workspaceRoot });
  const compiler = new PackageGraphCompiler();
  const classified = await Promise.all(
    ctx.dependencies.map(async (dep) => {
      const recipe = resolveByPackageName(dep.name) ?? undefined;
      const api = await compiler.analyze(dep, {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        recipeVersion: recipe?.recipeVersion,
      });
      return {
        api,
        classification: classify(api, recipe),
        recipe,
      };
    }),
  );

  return buildRuntimeMatrix(classified);
}

export async function runCheckCommand(
  workspaceRoot: string,
): Promise<GenerateResult> {
  const ctx = discover({ workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });

  const matrix = await loadRuntimeMatrixForCheck(workspaceRoot);
  const guardDiagnostics = checkImportGuards(appGraph.moduleGraph, matrix);
  const errors = guardDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const warnings = guardDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );

  return attachFailureKind({
    changed: [],
    unchanged: [],
    warnings,
    errors,
    exitCode: errors.length > 0 ? 1 : 0,
    failureKind: errors.length > 0 ? "guard_violation" : undefined,
  });
}

export async function runInspectCommand(
  target: InspectTarget,
  workspaceRoot: string,
): Promise<InspectResult> {
  const dataPaths: Record<InspectTarget, string> = {
    app: `${GENERATED_DIR}/appGraph.json`,
    packages: `${GENERATED_DIR}/packageGraph.json`,
    capabilities: `${GENERATED_DIR}/runtimeMatrix.json`,
    "runtime-matrix": `${GENERATED_DIR}/runtimeMatrix.json`,
    data: `${GENERATED_DIR}/dataGraph.json`,
    runtime: `${GENERATED_DIR}/runtimeGraph.json`,
    dev: `${GENERATED_DIR}/devManifest.json`,
    subscriptions: `${GENERATED_DIR}/actionSubscriptions.json`,
    workflows: `${GENERATED_DIR}/workflowRegistry.json`,
    telemetry: `${GENERATED_DIR}/telemetryRegistry.json`,
    policies: `${GENERATED_DIR}/policyRegistry.json`,
  };

  const relative = dataPaths[target];
  const data = readGeneratedJson<unknown>(workspaceRoot, relative);

  if (data === null) {
    return {
      target,
      data: null,
      warnings: [],
      errors: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_INSPECT_MISSING",
          message: `missing generated artifact: ${relative}; run forge generate first`,
          file: relative,
        }),
      ],
      exitCode: 1,
      failureKind: "missing_artifact",
    };
  }

  return {
    target,
    data,
    warnings: [],
    errors: [],
    exitCode: 0,
  };
}

export async function executeCommand(command: ForgeCommand): Promise<number> {
  switch (command.kind) {
    case "generate": {
      const result = await runGenerateCommand({
        workspaceRoot: process.cwd(),
        check: command.check,
        dryRun: command.dryRun,
        json: command.json,
        concurrency: command.concurrency,
      });

      if (command.json) {
        process.stdout.write(formatJsonResult(buildGenerateJson(result)));
      } else {
        writeHumanGenerate(result);
      }

      return result.exitCode;
    }
    case "add": {
      const result = await runAddCommand(command.alias, command.options);
      if (command.options.json) {
        process.stdout.write(formatJsonResult(buildAddJson(result)));
      } else {
        writeHumanAdd(result);
      }
      return result.exitCode;
    }
    case "inspect": {
      const result = await runInspectCommand(
        command.target,
        process.cwd(),
      );
      if (command.json) {
        process.stdout.write(formatJsonResult(buildInspectJson(result)));
      } else {
        writeHumanInspect(result);
      }
      return result.exitCode;
    }
    case "check": {
      const result = await runCheckCommand(process.cwd());
      if (command.json) {
        process.stdout.write(formatJsonResult(buildGenerateJson(result)));
      } else {
        writeHumanGenerate(result);
      }
      return result.exitCode;
    }
    case "verify": {
      const result = await runVerifyCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatJsonResult(buildVerifyJson(result)));
      } else {
        writeHumanVerify(result);
      }
      return result.exitCode;
    }
    case "run": {
      const result = await runRunCommand({
        name: command.name,
        list: command.list,
        json: command.json,
        mock: command.mock,
        userId: command.userId,
        tenantId: command.tenantId,
        role: command.role,
        workspaceRoot: command.workspaceRoot,
      });

      if (command.json) {
        process.stdout.write(formatRunJson(result));
      } else if (result.list) {
        process.stdout.write(formatRunListHuman(result.list));
      } else if (result.run) {
        process.stdout.write(formatRunResultHuman(result.run));
      }

      return result.exitCode;
    }
    case "dev": {
      const result = await runDevCommand({
        workspaceRoot: command.workspaceRoot,
        host: command.host,
        port: command.port,
        mock: command.mock,
        watch: command.watch,
        json: command.json,
        db: command.db,
        databaseUrl: command.databaseUrl,
        worker: command.worker,
        telemetry: command.telemetry,
      });
      return result.exitCode;
    }
    case "db": {
      const result = await runDbCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        db: command.db,
        databaseUrl: command.databaseUrl,
        json: command.json,
      });

      if (command.json) {
        process.stdout.write(formatDbJson(result));
      } else {
        process.stdout.write(formatDbHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "outbox": {
      const result = await runOutboxCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        db: command.db,
        databaseUrl: command.databaseUrl,
        json: command.json,
        once: command.once,
        watch: command.watch,
        limit: command.limit,
        deliveryId: command.deliveryId,
        mock: command.mock,
      });

      if (command.json) {
        process.stdout.write(formatOutboxJson(result));
      } else {
        process.stdout.write(formatOutboxHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "workflow": {
      const result = await runWorkflowCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        db: command.db,
        databaseUrl: command.databaseUrl,
        json: command.json,
        once: command.once,
        watch: command.watch,
        limit: command.limit,
        workflowName: command.workflowName,
        runId: command.runId,
        stepName: command.stepName,
        input: command.input,
        mock: command.mock,
      });

      if (command.json) {
        process.stdout.write(formatWorkflowJson(result));
      } else {
        process.stdout.write(formatWorkflowHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "telemetry": {
      const result = await runTelemetryCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        db: command.db,
        databaseUrl: command.databaseUrl,
        json: command.json,
        traceId: command.traceId,
        sink: command.sink,
        file: command.file,
      });

      if (command.json) {
        process.stdout.write(formatTelemetryJson(result));
      } else {
        process.stdout.write(formatTelemetryHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "policy": {
      const result = await runPolicyCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        json: command.json,
        policy: command.policy,
        role: command.role,
        strictPolicies: command.strictPolicies,
      });

      if (command.json) {
        process.stdout.write(formatPolicyJson(result));
      } else {
        process.stdout.write(formatPolicyHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    default:
      return 1;
  }
}

export { runVerifyCommand };
export type { VerifyOptions, VerifyResult };
