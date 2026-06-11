import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { classify } from "../compiler/classifier/classify.ts";
import { buildRuntimeMatrix } from "../compiler/classifier/runtime-matrix.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { forgeAdd } from "../compiler/integration/add.ts";
import { checkImportGuards } from "../compiler/guards/check-import-guards.ts";
import { checkDirectProcessEnvUsage } from "../compiler/guards/check-process-env.ts";
import { checkAiUsageInApp } from "../compiler/guards/check-ai-usage.ts";
import { checkQueryUsageInApp } from "../compiler/guards/check-query-usage.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
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
import { initializeRuntimeEnv } from "../runtime/context/create-context.ts";
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
import {
  formatEnvHuman,
  formatEnvJson,
  formatSecretsHuman,
  formatSecretsJson,
  runEnvCommand,
  runSecretsCommand,
} from "./secrets.ts";
import { formatAiHuman, formatAiJson, runAiCommand } from "./ai.ts";
import { formatNewHuman, runNewCommand } from "./new.ts";
import { formatBuildHuman, runBuildCommand } from "./build.ts";
import { runServeCommand } from "./serve.ts";
import { runWorkerCommand } from "./worker.ts";
import { formatSelfHostHuman, runSelfHostCommand } from "./self-host.ts";
import {
  formatAgentContractHuman,
  runAgentContractPrint,
} from "./agent-contract.ts";
import {
  formatDoctorHuman,
  formatDoctorJson,
  runDoctorCommand,
} from "./doctor.ts";
import { formatAuthHuman, formatAuthJson, runAuthCommand } from "./auth.ts";
import { formatRlsHuman, formatRlsJson, runRlsCommand } from "./rls.ts";
import { formatDepsHuman, formatDepsJson, runDepsCommand } from "./deps.ts";
import {
  formatReleaseHuman,
  formatReleaseJson,
  runReleaseCommand,
} from "./release.ts";
import { formatMakeHuman, formatMakeJson, runMakeCommand } from "./make.ts";
import { formatFeatureHuman, formatFeatureJson, runFeatureCommand } from "./feature.ts";
import { formatRefactorHuman, formatRefactorJson, runRefactorCommand } from "./refactor.ts";
import {
  formatImpactHuman,
  formatImpactJson,
  runImpactCommand,
  runTestCommand,
} from "../impact/index.ts";
import {
  formatRepairHuman,
  formatRepairJson,
  runRepairCommand,
} from "../repair/index.ts";
import {
  formatAgentHuman,
  formatAgentJson,
  runAgentCommand,
} from "../agent-adapters/index.ts";
import {
  formatReviewHuman,
  formatReviewJson,
  runReviewCommand,
  renderReviewMarkdown,
  renderSarif,
} from "../review/index.ts";
import {
  formatQueryJson,
  formatQueryListHuman,
  formatQueryResultHuman,
  runQueryCommand,
} from "./query.ts";
import { runLiveCommand } from "./live.ts";
import { runQuery } from "../runtime/query/run-query.ts";
import { resolveAuthFromCli } from "../runtime/auth/resolve.ts";
import { getActiveDbAdapter } from "../runtime/executor.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

function readGeneratedText(workspaceRoot: string, relative: string): string | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  return stripDeterministicHeader(readFileSync(absolute, "utf8"));
}

export async function runGenerateCommand(
  options: GenerateOptions,
): Promise<GenerateResult> {
  const result = await run(options);
  return attachFailureKind(result);
}

export async function runAddCommand(
  alias: string,
  options: Extract<ForgeCommand, { kind: "add" }>["options"],
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
  options?: { strictSecrets?: boolean },
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
  const secretRegistry = loadSecretRegistry(workspaceRoot);
  const processEnvDiagnostics = checkDirectProcessEnvUsage(
    workspaceRoot,
    secretRegistry,
    options?.strictSecrets ?? false,
  );
  const aiDiagnostics = checkAiUsageInApp(appGraph);
  const queryDiagnostics = checkQueryUsageInApp(appGraph);

  const allDiagnostics = [
    ...guardDiagnostics,
    ...processEnvDiagnostics,
    ...aiDiagnostics,
    ...queryDiagnostics,
  ];
  const errors = allDiagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const warnings = allDiagnostics.filter(
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
  const dataPaths: Partial<Record<InspectTarget, string>> = {
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
    secrets: `${GENERATED_DIR}/secretRegistry.json`,
    env: `${GENERATED_DIR}/envSchema.json`,
    ai: `${GENERATED_DIR}/aiRegistry.json`,
    queries: `${GENERATED_DIR}/queryRegistry.json`,
    api: `${GENERATED_DIR}/api.json`,
    client: `${GENERATED_DIR}/clientManifest.json`,
    auth: `${GENERATED_DIR}/authRegistry.json`,
    rls: `${GENERATED_DIR}/rlsPolicies.json`,
    "db-security": `${GENERATED_DIR}/dbSecurityManifest.json`,
    release: `${GENERATED_DIR}/releaseManifest.json`,
    artifacts: `${GENERATED_DIR}/artifactManifest.json`,
    sourcemaps: `${GENERATED_DIR}/sourceMapManifest.json`,
    "live-production": `${GENERATED_DIR}/liveProductionManifest.json`,
    "live-protocol": `${GENERATED_DIR}/liveProtocol.json`,
    "live-transport": `${GENERATED_DIR}/liveTransportConfig.json`,
    make: `${GENERATED_DIR}/makeRegistry.json`,
    "test-graph": `${GENERATED_DIR}/testGraph.json`,
    "test-plans": `${GENERATED_DIR}/testPlanRegistry.json`,
    "agent-adapters": `${GENERATED_DIR}/agentAdapterManifest.json`,
    rules: `${GENERATED_DIR}/runtimeRules.md`,
    map: `${GENERATED_DIR}/appMap.md`,
  };

  if (target === "all") {
    const aggregatePaths: Array<[string, string]> = [
      ["app", `${GENERATED_DIR}/appGraph.json`],
      ["data", `${GENERATED_DIR}/dataGraph.json`],
      ["packages", `${GENERATED_DIR}/packageGraph.json`],
      ["runtimeMatrix", `${GENERATED_DIR}/runtimeMatrix.json`],
      ["runtime", `${GENERATED_DIR}/runtimeGraph.json`],
      ["policies", `${GENERATED_DIR}/policyRegistry.json`],
      ["secrets", `${GENERATED_DIR}/secretRegistry.json`],
      ["workflows", `${GENERATED_DIR}/workflowRegistry.json`],
      ["telemetry", `${GENERATED_DIR}/telemetryRegistry.json`],
      ["ai", `${GENERATED_DIR}/aiRegistry.json`],
      ["client", `${GENERATED_DIR}/clientManifest.json`],
      ["auth", `${GENERATED_DIR}/authRegistry.json`],
      ["rls", `${GENERATED_DIR}/rlsPolicies.json`],
      ["dbSecurity", `${GENERATED_DIR}/dbSecurityManifest.json`],
      ["release", `${GENERATED_DIR}/releaseManifest.json`],
      ["artifacts", `${GENERATED_DIR}/artifactManifest.json`],
      ["sourceMaps", `${GENERATED_DIR}/sourceMapManifest.json`],
      ["liveProduction", `${GENERATED_DIR}/liveProductionManifest.json`],
      ["liveProtocol", `${GENERATED_DIR}/liveProtocol.json`],
      ["liveTransport", `${GENERATED_DIR}/liveTransportConfig.json`],
      ["make", `${GENERATED_DIR}/makeRegistry.json`],
      ["testGraph", `${GENERATED_DIR}/testGraph.json`],
      ["testPlanRegistry", `${GENERATED_DIR}/testPlanRegistry.json`],
      ["agentContract", `${GENERATED_DIR}/agentContract.json`],
      ["agentAdapters", `${GENERATED_DIR}/agentAdapterManifest.json`],
    ];
    const data: Record<string, unknown> = {};
    const errors = [];
    for (const [key, relative] of aggregatePaths) {
      const value = readGeneratedJson<unknown>(workspaceRoot, relative);
      if (value === null) {
        errors.push(
          createDiagnostic({
            severity: "error",
            code: "FORGE_INSPECT_MISSING",
            message: `missing generated artifact: ${relative}; run forge generate first`,
            file: relative,
          }),
        );
      } else {
        data[key] = value;
      }
    }
    data.diagnostics = errors;
    return {
      target,
      data,
      warnings: [],
      errors,
      exitCode: errors.length > 0 ? 1 : 0,
      failureKind: errors.length > 0 ? "missing_artifact" : undefined,
    };
  }

  const relative = dataPaths[target];
  if (!relative) {
    return {
      target,
      data: null,
      warnings: [],
      errors: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_INSPECT_MISSING",
          message: `unsupported inspect target: ${target}`,
        }),
      ],
      exitCode: 1,
      failureKind: "missing_artifact",
    };
  }
  const data =
    target === "rules" || target === "map"
      ? readGeneratedText(workspaceRoot, relative)
      : readGeneratedJson<unknown>(workspaceRoot, relative);

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
    case "new": {
      const result = await runNewCommand({
        name: command.name,
        template: command.template,
        packageManager: command.packageManager,
        install: command.install,
        git: command.git,
        workspaceRoot: command.workspaceRoot,
      });
      process.stdout.write(formatNewHuman(result));
      return result.exitCode;
    }
    case "build": {
      const result = await runBuildCommand({
        workspaceRoot: command.workspaceRoot,
        json: command.json,
      });
      if (command.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(formatBuildHuman(result));
      }
      return result.exitCode;
    }
    case "serve":
      return runServeCommand(command);
    case "worker": {
      const result = await runWorkerCommand(command);
      return result.exitCode;
    }
    case "self-host": {
      const result = await runSelfHostCommand(command);
      if (command.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(formatSelfHostHuman(result));
      }
      return result.exitCode;
    }
    case "agent-contract": {
      if (command.subcommand === "print") {
        const result = runAgentContractPrint(command.workspaceRoot);
        if (command.json) {
          process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
        } else {
          process.stdout.write(formatAgentContractHuman(command.subcommand, result));
        }
        return result.exitCode;
      }

      const result = await runGenerateCommand({
        workspaceRoot: command.workspaceRoot,
        check: command.subcommand === "check",
        dryRun: false,
        json: command.json,
        concurrency: 4,
      });
      if (command.json) {
        process.stdout.write(formatJsonResult(buildGenerateJson(result)));
      } else {
        process.stdout.write(formatAgentContractHuman(command.subcommand, result));
        writeHumanGenerate(result);
      }
      return result.exitCode;
    }
    case "doctor": {
      const result = await runDoctorCommand({ workspaceRoot: command.workspaceRoot });
      if (command.json) {
        process.stdout.write(formatDoctorJson(result));
      } else {
        process.stdout.write(formatDoctorHuman(result));
      }
      return result.exitCode;
    }
    case "auth": {
      const result = await runAuthCommand(command);
      if (command.json) {
        process.stdout.write(formatAuthJson(result));
      } else {
        process.stdout.write(formatAuthHuman(result));
      }
      return result.exitCode;
    }
    case "rls": {
      const result = await runRlsCommand(command);
      if (command.json) {
        process.stdout.write(formatRlsJson(result));
      } else {
        process.stdout.write(formatRlsHuman(command.subcommand, result));
      }
      return result.exitCode;
    }
    case "deps": {
      const result = await runDepsCommand(command);
      if (command.json) {
        process.stdout.write(formatDepsJson(result));
      } else {
        process.stdout.write(formatDepsHuman(command.subcommand, result));
      }
      return result.exitCode;
    }
    case "release": {
      const result = await runReleaseCommand({
        ...command,
        provider: command.provider as import("../compiler/release/types.ts").ReleaseExportProvider | undefined,
        target: command.target as import("../compiler/release/types.ts").ReleaseExportProvider | undefined,
      });
      if (command.json) {
        process.stdout.write(formatReleaseJson(result));
      } else {
        process.stdout.write(formatReleaseHuman(result));
      }
      return result.exitCode;
    }
    case "make": {
      const result = await runMakeCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatMakeJson(result));
      } else {
        process.stdout.write(formatMakeHuman(result));
      }
      return result.exitCode;
    }
    case "feature": {
      const result = await runFeatureCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatFeatureJson(result));
      } else {
        process.stdout.write(formatFeatureHuman(result));
      }
      return result.exitCode;
    }
    case "refactor": {
      const result = await runRefactorCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatRefactorJson(result));
      } else {
        process.stdout.write(formatRefactorHuman(result));
      }
      return result.exitCode;
    }
    case "impact": {
      const result = runImpactCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatImpactJson(result));
      } else {
        process.stdout.write(formatImpactHuman(result));
      }
      return result.exitCode;
    }
    case "test": {
      const result = await runTestCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatImpactJson(result));
      } else {
        process.stdout.write(formatImpactHuman(result));
      }
      return result.exitCode;
    }
    case "repair": {
      const result = await runRepairCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatRepairJson(result));
      } else {
        process.stdout.write(formatRepairHuman(result));
      }
      return result.exitCode;
    }
    case "agent": {
      const result = await runAgentCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatAgentJson(result));
      } else {
        process.stdout.write(formatAgentHuman(result));
      }
      return result.exitCode;
    }
    case "review": {
      const result = runReviewCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatReviewJson(result));
      } else if (command.options.md && result.report) {
        process.stdout.write(renderReviewMarkdown(result.report));
      } else if (command.options.sarif && result.report && !command.options.write) {
        process.stdout.write(renderSarif(result.report));
      } else {
        process.stdout.write(formatReviewHuman(result));
      }
      return result.exitCode;
    }
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
      } else if (typeof result.data === "string") {
        process.stdout.write(result.data);
      } else {
        writeHumanInspect(result);
      }
      return result.exitCode;
    }
    case "check": {
      const result = await runCheckCommand(process.cwd(), {
        strictSecrets: command.strictSecrets,
      });
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
      initializeRuntimeEnv(
        command.workspaceRoot,
        command.envFile ? [command.envFile] : undefined,
      );

      if (command.queryMode && command.name) {
        const tableMap = readGeneratedJson<{ tableMap: Record<string, import("../compiler/data-graph/sql/serialize.ts").TableMapEntry> }>(
          command.workspaceRoot,
          `${GENERATED_DIR}/db.json`,
        )?.tableMap;

        const run = await runQuery(
          command.workspaceRoot,
          command.name,
          {
            args: command.args,
            auth: resolveAuthFromCli({
              userId: command.userId,
              tenantId: command.tenantId,
              role: command.role,
            }),
          },
          {
            adapter: getActiveDbAdapter(),
            tableMap,
          },
        );

        if (command.json) {
          process.stdout.write(`${JSON.stringify({ run }, null, 2)}\n`);
        } else {
          process.stdout.write(formatQueryResultHuman(run));
        }
        return run.exitCode;
      }

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
      initializeRuntimeEnv(
        command.workspaceRoot,
        command.envFile ? [command.envFile] : undefined,
      );
      const result = await runDevCommand({
        workspaceRoot: command.workspaceRoot,
        host: command.host,
        port: command.port,
        mock: command.mock,
        mockAi: command.mockAi,
        watch: command.watch,
        json: command.json,
        db: command.db,
        databaseUrl: command.databaseUrl,
        worker: command.worker,
        telemetry: command.telemetry,
        envFile: command.envFile,
      });
      return result.exitCode;
    }
    case "db": {
      if (command.subcommand === "rls-check") {
        const result = await runRlsCommand({
          subcommand: "check",
          workspaceRoot: command.workspaceRoot,
          db: command.db,
          databaseUrl: command.databaseUrl,
          json: command.json,
        });
        if (command.json) {
          process.stdout.write(formatRlsJson(result));
        } else {
          process.stdout.write(formatRlsHuman("check", result));
        }
        return result.exitCode;
      }

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
    case "secrets": {
      const result = await runSecretsCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        json: command.json,
        redacted: command.redacted,
        name: command.name,
        value: command.value,
      });

      if (command.json) {
        process.stdout.write(formatSecretsJson(result));
      } else {
        process.stdout.write(formatSecretsHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "env": {
      const result = await runEnvCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        json: command.json,
        redacted: command.redacted,
      });

      if (command.json) {
        process.stdout.write(formatEnvJson(result));
      } else {
        process.stdout.write(formatEnvHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    case "query": {
      const result = await runQueryCommand({
        subcommand: command.subcommand,
        name: command.name,
        args: command.args,
        json: command.json,
        userId: command.userId,
        tenantId: command.tenantId,
        role: command.role,
        workspaceRoot: command.workspaceRoot,
      });

      if (command.json) {
        process.stdout.write(formatQueryJson(result));
      } else if (result.list) {
        process.stdout.write(formatQueryListHuman(result.list));
      } else if (result.run) {
        process.stdout.write(formatQueryResultHuman(result.run));
      }

      return result.exitCode;
    }
    case "live": {
      return runLiveCommand({
        subcommand: command.subcommand,
        name: command.name,
        args: command.args,
        json: command.json,
        userId: command.userId,
        tenantId: command.tenantId,
        role: command.role,
        url: command.url,
      });
    }
    case "ai": {
      const result = await runAiCommand({
        subcommand: command.subcommand,
        workspaceRoot: command.workspaceRoot,
        json: command.json,
        provider: command.provider,
        model: command.model,
        prompt: command.prompt,
        mock: command.mock,
      });

      if (command.json) {
        process.stdout.write(formatAiJson(result));
      } else {
        process.stdout.write(formatAiHuman(command.subcommand, result));
      }

      return result.exitCode;
    }
    default:
      return 1;
  }
}

export { runVerifyCommand };
export type { VerifyOptions, VerifyResult };
