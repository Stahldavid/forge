import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import type { TestRunRecord } from "../../src/forge/impact/types.ts";
import {
  formatRepairJson,
  runRepairCommand,
  writeRepairPlan,
} from "../../src/forge/repair/index.ts";
import type { RepairCommandOptions, RepairPlan } from "../../src/forge/repair/types.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h29-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function base(root: string): RepairCommandOptions {
  return {
    subcommand: "diagnose",
    workspaceRoot: root,
    json: true,
    fromLastTestRun: false,
    write: false,
    yes: false,
    keepFailed: false,
    allowMediumConfidence: false,
    maxAttempts: 1,
    commitFriendly: false,
  };
}

function lastRun(root: string, stdout: string, command = "forge check"): void {
  const record: TestRunRecord = {
    schemaVersion: "0.1.0",
    id: "run_test",
    changedHash: "sha256:test",
    planHash: "sha256:test",
    source: { mode: "changed", base: "HEAD" },
    commands: [command],
    results: [
      {
        command,
        ok: false,
        exitCode: 1,
        durationMs: 10,
        stdout,
        stderr: "",
        failureKind: "test-failure",
      },
    ],
    failed: [command],
    durationMs: 10,
  };
  write(root, ".forge/test-runs/last.json", JSON.stringify(record));
}

describe("H29 repair loop", () => {
  test("FORGE_DRIFT suggests forge generate with high confidence", async () => {
    const root = workspace();
    const result = await runRepairCommand({
      ...base(root),
      diagnosticCode: "FORGE_DRIFT",
    });

    expect(result.diagnosis?.failureKind).toBe("generated-drift");
    expect(result.diagnosis?.confidence).toBe("high");
    expect(result.diagnosis?.suggestedRepairs[0].command).toBe("forge generate");
  });

  test("last test run guard violation suggests extract-action", async () => {
    const root = workspace();
    lastRun(
      root,
      "FORGE_GUARD_VIOLATION: stripe is reachable from command createCheckout through src/commands/createCheckout.ts",
    );
    const result = await runRepairCommand({
      ...base(root),
      fromLastTestRun: true,
    });

    expect(result.diagnosis?.failureKind).toBe("runtime-guard");
    expect(result.diagnosis?.suggestedRepairs[0].kind).toBe("refactor");
    expect(result.diagnosis?.suggestedRepairs[0].command).toContain("forge refactor extract-action createCheckout");
  });

  test("policy and secret diagnostics produce make/refactor guidance", async () => {
    const root = workspace();
    const policy = await runRepairCommand({
      ...base(root),
      diagnosticCode: "FORGE_POLICY_UNKNOWN",
    });
    expect(policy.diagnosis?.failureKind).toBe("policy-auth");
    expect(policy.diagnosis?.suggestedRepairs.some((repair) => repair.command?.includes("forge make policy"))).toBe(true);

    const secret = await runRepairCommand({
      ...base(root),
      diagnosticCode: "FORGE_SECRET_DIRECT_PROCESS_ENV",
    });
    expect(secret.diagnosis?.failureKind).toBe("secrets");
    expect(secret.diagnosis?.suggestedRepairs.some((repair) => repair.command?.includes("replace-process-env"))).toBe(true);
  });

  test("AI, workflow, and outbox failures are classified", async () => {
    const root = workspace();
    const ai = await runRepairCommand({ ...base(root), diagnosticCode: "FORGE_AI_FORBIDDEN_CONTEXT" });
    expect(ai.diagnosis?.failureKind).toBe("ai");

    const workflow = await runRepairCommand({ ...base(root), workflowRunId: "42" });
    expect(workflow.diagnosis?.failureKind).toBe("workflow");
    expect(workflow.diagnosis?.suggestedRepairs[0].command).toContain("forge workflow inspect");

    const outbox = await runRepairCommand({ ...base(root), outboxDeliveryId: "12" });
    expect(outbox.diagnosis?.failureKind).toBe("outbox");
    expect(outbox.diagnosis?.suggestedRepairs[0].command).toContain("forge outbox retry");
  });

  test("plan writes deterministic artifacts and JSON output is agent-friendly", async () => {
    const root = workspace();
    const result = await runRepairCommand({
      ...base(root),
      subcommand: "plan",
      diagnosticCode: "FORGE_DRIFT",
      write: true,
    });
    expect(result.plan?.id).toBeString();
    expect(existsSync(join(root, ".forge/repairs", result.plan!.id, "plan.json"))).toBe(true);
    expect(formatRepairJson(result)).toContain("\"schemaVersion\"");
  });

  test("apply runs high-confidence command plans and refuses low-confidence plans", async () => {
    const root = workspace();
    write(root, "tests/pass.test.ts", `import { test, expect } from "bun:test"; test("pass", () => expect(1).toBe(1));`);
    const high = await runRepairCommand({
      ...base(root),
      subcommand: "plan",
      diagnosticCode: "FORGE_DRIFT",
      write: false,
    });
    const plan = {
      ...high.plan!,
      commandsToRun: ["bun test tests/pass.test.ts"],
      diagnosis: {
        ...high.plan!.diagnosis,
        suggestedRepairs: [
          {
            ...high.plan!.diagnosis.suggestedRepairs[0],
            command: "bun test tests/pass.test.ts",
            requiresConfirmation: false,
          },
        ],
      },
    } satisfies RepairPlan;
    writeRepairPlan(root, plan);

    const applied = await runRepairCommand({
      ...base(root),
      subcommand: "apply",
      repairId: plan.id,
      yes: true,
    });
    expect(applied.ok).toBe(true);
    expect(applied.record?.status).toBe("applied");

    const low = {
      ...plan,
      id: "repair_low",
      diagnosis: {
        ...plan.diagnosis,
        id: "repair_low",
        confidence: "low" as const,
        suggestedRepairs: [
          {
            ...plan.diagnosis.suggestedRepairs[0],
            id: "manual-review",
            kind: "manual" as const,
            confidence: "low" as const,
            command: undefined,
          },
        ],
      },
      selectedRepair: "manual-review",
      commandsToRun: [],
    } satisfies RepairPlan;
    writeRepairPlan(root, low);
    const refused = await runRepairCommand({
      ...base(root),
      subcommand: "apply",
      repairId: low.id,
      yes: true,
    });
    expect(refused.ok).toBe(false);
    expect(refused.diagnostics[0].code).toBe("FORGE_REPAIR_LOW_CONFIDENCE");
  });
});
