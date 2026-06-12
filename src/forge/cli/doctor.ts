import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  severity: "error" | "warning";
  message?: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  exitCode: 0 | 1;
}

function present(workspaceRoot: string, name: string, relative: string): DoctorCheck {
  const ok = nodeFileSystem.exists(join(workspaceRoot, relative));
  return {
    name,
    ok,
    severity: "error",
    message: ok ? undefined : `missing ${relative}`,
  };
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "")) as T;
  } catch {
    return null;
  }
}

export async function runDoctorCommand(options: {
  workspaceRoot: string;
}): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [
    present(options.workspaceRoot, "agents-md", "AGENTS.md"),
    present(options.workspaceRoot, "forge-lock", "forge.lock"),
    present(options.workspaceRoot, "agent-contract", `${GENERATED_DIR}/agentContract.json`),
    present(options.workspaceRoot, "runtime-matrix", `${GENERATED_DIR}/runtimeMatrix.json`),
    present(options.workspaceRoot, "data-graph", `${GENERATED_DIR}/dataGraph.json`),
    present(options.workspaceRoot, "policies", `${GENERATED_DIR}/policyRegistry.json`),
    present(options.workspaceRoot, "secrets", `${GENERATED_DIR}/secretRegistry.json`),
    present(options.workspaceRoot, "client", `${GENERATED_DIR}/clientManifest.json`),
    present(options.workspaceRoot, "frontend", `${GENERATED_DIR}/frontendGraph.json`),
    present(options.workspaceRoot, "live-query", `${GENERATED_DIR}/liveQueryRegistry.json`),
  ];

  const generateCheck = await runGenerate({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  checks.push({
    name: "generated",
    ok: generateCheck.exitCode === 0,
    severity: "error",
    message:
      generateCheck.exitCode === 0
        ? undefined
        : "generated artifacts are stale; run forge generate",
  });

  const deployManifest = join(options.workspaceRoot, "deploy", "deployManifest.json");
  if (nodeFileSystem.exists(deployManifest)) {
    checks.push(
      present(options.workspaceRoot, "self-host-compose", "deploy/docker-compose.yml"),
      present(options.workspaceRoot, "self-host-env", "deploy/.env.example"),
    );
  }

  const webRoot = join(options.workspaceRoot, "web");
  if (nodeFileSystem.exists(webRoot)) {
    const frontendGraph = readGeneratedJson<FrontendGraph>(
      options.workspaceRoot,
      `${GENERATED_DIR}/frontendGraph.json`,
    );
    checks.push({
      name: "frontend-root",
      ok: frontendGraph?.present === true,
      severity: "error",
      message: frontendGraph?.present === true ? undefined : "web/ exists but frontendGraph does not detect it",
    });
    checks.push({
      name: "frontend-bridge",
      ok: (frontendGraph?.bridgeFiles.length ?? 0) > 0,
      severity: "warning",
      message:
        (frontendGraph?.bridgeFiles.length ?? 0) > 0
          ? undefined
          : "missing web/lib/forge.ts bridge to generated client",
    });
    checks.push({
      name: "frontend-provider",
      ok: (frontendGraph?.providers.length ?? 0) > 0 || frontendGraph?.framework === "static",
      severity: "warning",
      message:
        (frontendGraph?.providers.length ?? 0) > 0 || frontendGraph?.framework === "static"
          ? undefined
          : "missing ForgeProvider in web app",
    });
    checks.push({
      name: "frontend-routes",
      ok: (frontendGraph?.routes.length ?? 0) > 0,
      severity: "warning",
      message:
        (frontendGraph?.routes.length ?? 0) > 0
          ? undefined
          : "no frontend routes detected in web/",
    });
  }

  const ok = checks.every((check) => check.ok || check.severity === "warning");
  return {
    ok,
    checks,
    exitCode: ok ? 0 : 1,
  };
}

export function formatDoctorJson(result: DoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatDoctorHuman(result: DoctorResult): string {
  const lines = ["Forge Doctor", ""];
  for (const check of result.checks) {
    const marker = check.ok ? "OK" : check.severity === "warning" ? "WARN" : "FAIL";
    lines.push(`${marker} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  lines.push("");
  lines.push(result.ok ? "Project is coherent." : "Project needs attention.");
  return `${lines.join("\n")}\n`;
}
