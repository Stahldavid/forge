import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
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
import {
  buildAppGraphForSession,
  discoverForSession,
  getCompileSession,
} from "../compiler/orchestrator/session.ts";
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
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
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
import { INSPECT_TARGETS, TOP_LEVEL_COMMANDS, type ForgeCommand } from "./parse.ts";
import { runVerifyCommand } from "./verify.ts";
import {
  buildExternalServiceGraph,
  importExternalManifest,
  readExternalManifestFile,
} from "../compiler/external-manifest/registry.ts";
import {
  resolveExternalQualifiedName,
  runExternalEntry,
} from "../runtime/external/bridge.ts";
import {
  formatCompilerBenchHuman,
  formatCompilerBenchJson,
  runCompilerBenchCommand,
} from "../bench.ts";
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
  formatDeltaExplainHuman,
  formatDeltaExplainJson,
  formatDeltaStatusHuman,
  formatDeltaStatusJson,
  formatDeltaSessionHuman,
  formatDeltaSessionJson,
  formatDeltaTimelineHuman,
  formatDeltaTimelineJson,
  runDeltaExplain,
  runDeltaSessionCommand,
  runDeltaStatus,
  runDeltaTimeline,
} from "../delta/index.ts";
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
import {
  formatWindowsDoctorHuman,
  formatWindowsDoctorJson,
  formatWindowsSetupHuman,
  formatWindowsSetupJson,
  runWindowsDoctorCommand,
  runWindowsSetupCommand,
} from "./windows.ts";
import { formatAuthHuman, formatAuthJson, runAuthCommand } from "./auth.ts";
import { formatRlsHuman, formatRlsJson, runRlsCommand } from "./rls.ts";
import {
  formatSecurityHuman,
  formatSecurityJson,
  runSecurityCommand,
} from "./security.ts";
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
  formatForgeDoHuman,
  formatForgeDoJson,
  runForgeDoCommand,
} from "../intent/index.ts";
import {
  formatAgentHuman,
  formatAgentJson,
  runAgentCommand,
} from "../agent-adapters/index.ts";
import { runMcpServe } from "../agent-memory/mcp.ts";
import {
  formatReviewHuman,
  formatReviewJson,
  runReviewCommand,
  renderReviewMarkdown,
  renderSarif,
} from "../review/index.ts";
import {
  formatUiHuman,
  formatUiJson,
  runUiCommand,
  runUiListCommand,
} from "../ui/index.ts";
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
import { CLI_VERSION, FORGEOS_VERSION } from "../version.ts";

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function readGeneratedText(workspaceRoot: string, relative: string): string | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  return stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
}

function readPackageJson(workspaceRoot: string): Record<string, unknown> {
  try {
    return JSON.parse(nodeFileSystem.readText(join(workspaceRoot, "package.json")) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function hasPath(workspaceRoot: string, relative: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, relative));
}

function sortedDirectoryNames(workspaceRoot: string, relative: string): string[] {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return [];
  }
  return nodeFileSystem
    .readDir(absolute)
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name)
    .sort();
}

function buildFrameworkInspect(workspaceRoot: string): Record<string, unknown> {
  const pkg = readPackageJson(workspaceRoot);
  const scripts = pkg.scripts && typeof pkg.scripts === "object"
    ? Object.keys(pkg.scripts as Record<string, string>).sort()
    : [];
  const dependencies = pkg.dependencies && typeof pkg.dependencies === "object"
    ? Object.keys(pkg.dependencies as Record<string, string>).sort()
    : [];
  const devDependencies = pkg.devDependencies && typeof pkg.devDependencies === "object"
    ? Object.keys(pkg.devDependencies as Record<string, string>).sort()
    : [];
  const templates = sortedDirectoryNames(workspaceRoot, "templates").map((name) => ({
    name,
    hasWeb: hasPath(workspaceRoot, `templates/${name}/web`),
    hasAgentsMd: hasPath(workspaceRoot, `templates/${name}/AGENTS.md`),
    packageJson: `templates/${name}/package.json`,
  }));
  const examples = sortedDirectoryNames(workspaceRoot, "examples").map((name) => ({
    name,
    sourceOnly: !hasPath(workspaceRoot, `examples/${name}/src/forge/_generated`) &&
      !hasPath(workspaceRoot, `examples/${name}/forge.lock`),
    hasWeb: hasPath(workspaceRoot, `examples/${name}/web`),
    hasAgentsMd: hasPath(workspaceRoot, `examples/${name}/AGENTS.md`),
  }));

  return {
    schemaVersion: "0.1.0",
    project: {
      name: typeof pkg.name === "string" ? pkg.name : "unknown",
      version: typeof pkg.version === "string" ? pkg.version : "unknown",
      private: pkg.private === true,
      type: "forgeos-framework",
    },
    packageManager: pkg.packageManager ?? "bun",
    scripts,
    dependencies,
    devDependencies,
    cli: {
      topLevelCommands: [...TOP_LEVEL_COMMANDS],
      inspectTargets: [...INSPECT_TARGETS],
      preferredEntryPoints: [
        "forge do <objective> --json",
        "forge dev --once --json",
        "forge inspect all --json",
        "forge inspect framework --json",
        "forge verify --strict",
      ],
    },
    modules: sortedDirectoryNames(workspaceRoot, "src/forge").map((name) => ({
      name,
      path: `src/forge/${name}`,
    })),
    templates,
    examples,
    tests: sortedDirectoryNames(workspaceRoot, "tests").map((name) => ({
      name,
      path: `tests/${name}`,
    })),
    generated: {
      directory: GENERATED_DIR,
      rootArtifacts: ["AGENTS.md", "forge.lock"],
      sourceOnlyExamples: examples
        .filter((example) => example.sourceOnly)
        .map((example) => example.name),
    },
    documentation: {
      readme: hasPath(workspaceRoot, "README.md"),
      agents: hasPath(workspaceRoot, "AGENTS.md"),
      ci: hasPath(workspaceRoot, ".github/workflows/ci.yml"),
    },
  };
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

  const ctx = discoverForSession(getCompileSession(workspaceRoot));
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
  const session = getCompileSession(workspaceRoot);
  const appGraph = await buildAppGraphForSession(session);

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
  const frontendDiagnostics =
    readGeneratedJson<FrontendGraph>(workspaceRoot, `${GENERATED_DIR}/frontendGraph.json`)
      ?.diagnostics ?? [];
  const capabilityDiagnostics =
    readGeneratedJson<{ diagnostics?: import("../compiler/types/diagnostic.ts").Diagnostic[] }>(
      workspaceRoot,
      `${GENERATED_DIR}/capabilityMap.json`,
    )?.diagnostics ?? [];
  const externalDiagnostics = buildExternalServiceGraph(workspaceRoot).diagnostics;

  const allDiagnostics = [
    ...guardDiagnostics,
    ...processEnvDiagnostics,
    ...aiDiagnostics,
    ...queryDiagnostics,
    ...frontendDiagnostics,
    ...capabilityDiagnostics,
    ...externalDiagnostics,
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

function formatManifestHuman(result: {
  subcommand: "validate" | "import";
  path: string;
  imported?: boolean;
  serviceCount?: number;
  diagnostics: import("../compiler/types/diagnostic.ts").Diagnostic[];
  exitCode: number;
}): string {
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const lines = [
    `manifest: ${result.subcommand}`,
    `path: ${result.path}`,
    result.subcommand === "import" ? `imported: ${result.imported ? "yes" : "no"}` : null,
    result.serviceCount !== undefined ? `external services: ${result.serviceCount}` : null,
    `errors: ${errors.length}`,
    `warnings: ${warnings.length}`,
  ].filter((line): line is string => line !== null);
  for (const diagnostic of result.diagnostics) {
    lines.push(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function runManifestCommand(command: Extract<ForgeCommand, { kind: "manifest" }>): {
  subcommand: "validate" | "import";
  path: string;
  imported?: boolean;
  serviceCount?: number;
  diagnostics: import("../compiler/types/diagnostic.ts").Diagnostic[];
  exitCode: number;
} {
  if (command.subcommand === "validate") {
    const result = readExternalManifestFile(command.path);
    const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      subcommand: "validate",
      path: command.path,
      diagnostics: result.diagnostics,
      exitCode: hasErrors ? 1 : 0,
    };
  }

  const result = importExternalManifest(command.workspaceRoot, command.path);
  const hasErrors = result.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    subcommand: "import",
    path: result.path,
    imported: result.imported,
    serviceCount: result.graph.services.length,
    diagnostics: result.diagnostics,
    exitCode: hasErrors ? 1 : 0,
  };
}

export async function runInspectCommand(
  target: InspectTarget,
  workspaceRoot: string,
): Promise<InspectResult> {
  const dataPaths: Partial<Record<InspectTarget, string>> = {
    app: `${GENERATED_DIR}/appGraph.json`,
    packages: `${GENERATED_DIR}/packageGraph.json`,
    capabilities: `${GENERATED_DIR}/capabilityMap.json`,
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
    external: `${GENERATED_DIR}/externalServices.json`,
    client: `${GENERATED_DIR}/clientManifest.json`,
    frontend: `${GENERATED_DIR}/frontendGraph.json`,
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
    "agent-contract": `${GENERATED_DIR}/agentContract.json`,
    "agent-tools": `${GENERATED_DIR}/agentTools.json`,
    "agent-adapters": `${GENERATED_DIR}/agentAdapterManifest.json`,
    "capability-map": `${GENERATED_DIR}/capabilityMap.json`,
    ui: `${GENERATED_DIR}/uiTestManifest.json`,
    "ui-scenarios": `${GENERATED_DIR}/uiScenarios.json`,
    "ui-routes": `${GENERATED_DIR}/uiRoutes.json`,
    rules: `${GENERATED_DIR}/runtimeRules.md`,
    map: `${GENERATED_DIR}/appMap.md`,
  };

  if (target === "framework") {
    return {
      target,
      data: buildFrameworkInspect(workspaceRoot),
      warnings: [],
      errors: [],
      exitCode: 0,
    };
  }

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
      ["externalServices", `${GENERATED_DIR}/externalServices.json`],
      ["client", `${GENERATED_DIR}/clientManifest.json`],
      ["frontend", `${GENERATED_DIR}/frontendGraph.json`],
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
      ["agentTools", `${GENERATED_DIR}/agentTools.json`],
      ["agentAdapters", `${GENERATED_DIR}/agentAdapterManifest.json`],
      ["capabilityMap", `${GENERATED_DIR}/capabilityMap.json`],
      ["ui", `${GENERATED_DIR}/uiTestManifest.json`],
      ["uiScenarios", `${GENERATED_DIR}/uiScenarios.json`],
      ["uiRoutes", `${GENERATED_DIR}/uiRoutes.json`],
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
    data.framework = buildFrameworkInspect(workspaceRoot);
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
    case "version": {
      if (command.json) {
        process.stdout.write(`${JSON.stringify({
          version: CLI_VERSION,
          cliVersion: CLI_VERSION,
          forgeosVersion: FORGEOS_VERSION,
        }, null, 2)}\n`);
      } else {
        process.stdout.write(`${CLI_VERSION}\n`);
      }
      return 0;
    }
    case "new": {
      const result = await runNewCommand({
        name: command.name,
        template: command.template,
        packageManager: command.packageManager,
        install: command.install,
        git: command.git,
        forgePackageSpec: command.forgePackageSpec,
        localForge: command.localForge,
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
      if (command.target === "windows") {
        const result = await runWindowsDoctorCommand({ workspaceRoot: command.workspaceRoot });
        if (command.json) {
          process.stdout.write(formatWindowsDoctorJson(result));
        } else {
          process.stdout.write(formatWindowsDoctorHuman(result));
        }
        return result.exitCode;
      }
      const result = await runDoctorCommand({ workspaceRoot: command.workspaceRoot });
      if (command.json) {
        process.stdout.write(formatDoctorJson(result));
      } else {
        process.stdout.write(formatDoctorHuman(result));
      }
      return result.exitCode;
    }
    case "setup": {
      const result = await runWindowsSetupCommand({
        workspaceRoot: command.workspaceRoot,
        yes: command.yes,
      });
      if (command.json) {
        process.stdout.write(formatWindowsSetupJson(result));
      } else {
        process.stdout.write(formatWindowsSetupHuman(result));
      }
      return result.exitCode;
    }
    case "security": {
      const result = await runSecurityCommand(command);
      if (command.json) {
        process.stdout.write(formatSecurityJson(result));
      } else {
        process.stdout.write(formatSecurityHuman(result));
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
    case "do": {
      const result = runForgeDoCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatForgeDoJson(result));
      } else {
        process.stdout.write(formatForgeDoHuman(result));
      }
      return result.exitCode;
    }
    case "bench": {
      const result = await runCompilerBenchCommand(command.options);
      process.stdout.write(
        command.options.json
          ? formatCompilerBenchJson(result)
          : formatCompilerBenchHuman(result),
      );
      return result.exitCode;
    }
    case "delta": {
      const result = await runDeltaStatus(command.workspaceRoot);
      process.stdout.write(command.json ? formatDeltaStatusJson(result) : formatDeltaStatusHuman(result));
      return result.exitCode;
    }
    case "session": {
      const result = await runDeltaSessionCommand({
        workspaceRoot: command.workspaceRoot,
        subcommand: command.subcommand,
        sessionId: command.sessionId,
        sourceSessionId: command.sourceSessionId,
        operationId: command.operationId,
        title: command.title,
        limit: command.limit,
      });
      process.stdout.write(command.json ? formatDeltaSessionJson(result) : formatDeltaSessionHuman(result));
      return result.exitCode;
    }
    case "timeline": {
      const result = await runDeltaTimeline({
        workspaceRoot: command.workspaceRoot,
        target: command.target,
        kind: command.kindFilter,
        session: command.sessionId,
        limit: command.limit,
        rebuild: command.rebuild,
      });
      process.stdout.write(command.json ? formatDeltaTimelineJson(result) : formatDeltaTimelineHuman(result));
      return result.exitCode;
    }
    case "explain": {
      const result = await runDeltaExplain({
        workspaceRoot: command.workspaceRoot,
        thing: command.thing,
      });
      process.stdout.write(command.json ? formatDeltaExplainJson(result) : formatDeltaExplainHuman(result));
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
    case "mcp": {
      return runMcpServe(command.workspaceRoot);
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
    case "ui": {
      const result =
        command.options.subcommand === "list"
          ? runUiListCommand(command.options.workspaceRoot)
          : await runUiCommand(command.options);
      if (command.options.json) {
        process.stdout.write(formatUiJson(result));
      } else {
        process.stdout.write(formatUiHuman(result));
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
    case "manifest": {
      const result = runManifestCommand(command);
      if (command.json) {
        process.stdout.write(formatJsonResult(result));
      } else {
        process.stdout.write(formatManifestHuman(result));
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
        const external = resolveExternalQualifiedName(command.workspaceRoot, command.name, "query");
        if (external) {
          const run = await runExternalEntry(command.workspaceRoot, {
            kind: "query",
            serviceName: external.serviceName,
            entryName: external.entryName,
            args: command.args,
            auth: resolveAuthFromCli({
              userId: command.userId,
              tenantId: command.tenantId,
              role: command.role,
            }),
          });
          const payload = { run };
          if (command.json) {
            process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
          } else {
            process.stdout.write(
              run.ok
                ? `${JSON.stringify(run.result, null, 2)}\n`
                : `${run.diagnostics.map((diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`).join("\n")}\n`,
            );
          }
          return run.exitCode;
        }

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
        args: command.args,
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
        once: command.once,
        watch: command.watch,
        json: command.json,
        db: command.db,
        databaseUrl: command.databaseUrl,
        worker: command.worker,
        withWeb: command.withWeb,
        apiOnly: command.apiOnly,
        webOnly: command.webOnly,
        open: command.open,
        webPort: command.webPort,
        telemetry: command.telemetry,
        envFile: command.envFile,
        skipStartupConsole: command.skipStartupConsole,
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
        modelLevel: command.modelLevel,
        live: command.live,
        traceId: command.traceId,
        db: command.db,
        databaseUrl: command.databaseUrl,
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
