import { existsSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";

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
  const ok = existsSync(join(workspaceRoot, relative));
  return {
    name,
    ok,
    severity: "error",
    message: ok ? undefined : `missing ${relative}`,
  };
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
  if (existsSync(deployManifest)) {
    checks.push(
      present(options.workspaceRoot, "self-host-compose", "deploy/docker-compose.yml"),
      present(options.workspaceRoot, "self-host-env", "deploy/.env.example"),
    );
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
