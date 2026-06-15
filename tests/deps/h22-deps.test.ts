import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runDepsCommand } from "../../src/forge/cli/deps.ts";
import { applyUpgradePlan } from "../../src/forge/compiler/package-upgrades/apply.ts";
import { createUpgradePlan } from "../../src/forge/compiler/package-upgrades/planner.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";

const REGISTRY = join(import.meta.dir, "..", "fixtures", "registry");

function installFixturePackage(workspace: string, packageName: string, version: string): void {
  const key = packageName.replace(/\//g, "__");
  const source = join(REGISTRY, key, version);
  const target = join(workspace, "node_modules", packageName);
  cpSync(source, target, { recursive: true, force: true });
}

async function scaffoldDepsWorkspace(prefix: string): Promise<string> {
  const workspace = scaffoldGenerateWorkspace(prefix);
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "forge-deps-test",
        private: true,
        type: "module",
        packageManager: "bun@1.3.14",
        dependencies: {
          zod: "4.0.1",
          stripe: "18.0.0",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  installFixturePackage(workspace, "zod", "4.0.1");
  installFixturePackage(workspace, "stripe", "18.0.0");

  const actionsDir = join(workspace, "src", "actions");
  const workflowsDir = join(workspace, "src", "workflows");
  mkdirSync(actionsDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  writeFileSync(
    join(actionsDir, "createCheckout.ts"),
    `
      import { action } from "forge/server";
      import { Stripe } from "stripe";
      export const createCheckout = action({
        handler: async () => {
          const stripe = new Stripe("sk_test");
          return stripe.checkout.sessions.create({ mode: "payment" });
        },
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(workflowsDir, "billingWorkflow.ts"),
    `
      import { step, workflow } from "forge/server";
      import { Stripe } from "stripe";
      export const billingWorkflow = workflow({
        steps: [
          step("createCheckout", async () => {
            const stripe = new Stripe("sk_test");
            return stripe.checkout.sessions.create({ mode: "payment" });
          }),
        ],
      });
    `,
    "utf8",
  );

  const generated = await runGenerateCommand(defaultGenerateOptions(workspace));
  if (generated.exitCode !== 0) {
    throw new Error(generated.errors.map((error) => error.message).join("; "));
  }
  return workspace;
}

describe("H22 package upgrade planner", () => {
  test("resolves fixture latest, emits deterministic plan, and detects stripe risk", async () => {
    const workspace = await scaffoldDepsWorkspace("h22-stripe");
    try {
      const result = await createUpgradePlan({
        workspaceRoot: workspace,
        packageName: "stripe",
        target: { kind: "dist-tag", tag: "latest" },
        registryDir: REGISTRY,
      });

      expect(result.exitCode).toBe(0);
      expect(result.plan?.to.version).toBe("19.0.0");
      expect(result.plan?.semver.bump).toBe("major");
      expect(result.plan?.risk.level).toBe("high");
      expect(result.plan?.apiDiff.changedSignatures.some((change) => change.exportName === "Stripe")).toBe(true);
      expect(result.plan?.affected.actions).toContain("createCheckout");
      expect(result.plan?.affected.workflows).toContain("billingWorkflow");
      expect(result.plan?.affected.generatedAdapters.length).toBeGreaterThan(0);
      expect(result.plan?.recommendedCommands).toContain("forge test run --changed --json");
      expect(result.plan?.recommendedCommands).toContain("forge verify --standard");
      expect(result.plan?.recommendedCommands.some((command) => command.startsWith("bun test"))).toBe(false);

      const planMd = readFileSync(join(result.planDir!, "plan.md"), "utf8");
      expect(planMd).toContain("# Package Upgrade Plan: stripe 18.0.0 -> 19.0.0");
      expect(planMd).toContain("Risk: HIGH");

      const second = await createUpgradePlan({
        workspaceRoot: workspace,
        packageName: "stripe",
        target: { kind: "dist-tag", tag: "latest" },
        registryDir: REGISTRY,
      });
      expect(readFileSync(join(second.planDir!, "plan.md"), "utf8")).toBe(planMd);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("patch upgrade without API diff is low risk", async () => {
    const workspace = await scaffoldDepsWorkspace("h22-zod");
    try {
      const result = await createUpgradePlan({
        workspaceRoot: workspace,
        packageName: "zod",
        target: { kind: "semver-bump", bump: "patch" },
        registryDir: REGISTRY,
      });

      expect(result.exitCode).toBe(0);
      expect(result.plan?.to.version).toBe("4.0.2");
      expect(result.plan?.apiDiff.changedSignatures).toEqual([]);
      expect(result.plan?.risk.level).toBe("low");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("deps CLI exposes outdated, inspect, diff, and upgrade-plan", async () => {
    const workspace = await scaffoldDepsWorkspace("h22-cli");
    try {
      process.env.FORGE_DEPS_REGISTRY_DIR = REGISTRY;
      expect(parseCli(["deps", "upgrade-plan", "stripe", "--to", "latest"]).command).toMatchObject({
        kind: "deps",
        subcommand: "upgrade-plan",
        packageName: "stripe",
        target: "latest",
      });
      expect(parseCli(["deps", "api", "stripe", "Stripe", "--json"]).command).toMatchObject({
        kind: "deps",
        subcommand: "api",
        packageName: "stripe",
        symbolName: "Stripe",
      });

      const outdated = await runDepsCommand({
        subcommand: "outdated",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect((outdated.data as { packages: Array<{ name: string }> }).packages.map((pkg) => pkg.name)).toContain("stripe");

      const inspect = await runDepsCommand({
        subcommand: "inspect",
        packageName: "stripe",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect((inspect.data as { integrationAlias: string }).integrationAlias).toBe("stripe");
      expect((inspect.data as { oracle: { entrypoints: unknown[] } }).oracle.entrypoints.length).toBeGreaterThan(0);

      const api = await runDepsCommand({
        subcommand: "api",
        packageName: "stripe",
        symbolName: "Stripe",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect(api.exitCode).toBe(0);
      expect((api.data as { symbols: Array<{ name: string; signature: string }> }).symbols[0]?.name).toBe("Stripe");
      expect((api.data as { symbols: Array<{ name: string; signature: string }> }).symbols[0]?.signature).toContain("apiKey");

      const missingApi = await runDepsCommand({
        subcommand: "api",
        packageName: "stripe",
        symbolName: "Nope",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect(missingApi.exitCode).toBe(1);
      expect(missingApi.diagnostics[0]?.code).toBe("FORGE_DEPS_UNKNOWN_EXPORT");

      const trace = await runDepsCommand({
        subcommand: "trace",
        packageName: "stripe",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect(trace.exitCode).toBe(0);
      expect((trace.data as { traces: Array<{ trace: Array<{ step: string }> }> }).traces[0]?.trace.some((step) => step.step === "package.types")).toBe(true);

      const compat = await runDepsCommand({
        subcommand: "runtime-compat",
        packageName: "stripe",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect(compat.exitCode).toBe(0);
      expect((compat.data as { runtimeCompatibility: { node: string } }).runtimeCompatibility.node).toBe("compatible");

      const diff = await runDepsCommand({
        subcommand: "diff",
        packageName: "stripe",
        target: "latest",
        json: true,
        yes: false,
        allowScripts: false,
        skipTests: false,
        dryRun: false,
        changed: false,
        workspaceRoot: workspace,
      });
      expect((diff.data as { apiDiff: { changedSignatures: unknown[] } }).apiDiff.changedSignatures.length).toBeGreaterThan(0);
    } finally {
      delete process.env.FORGE_DEPS_REGISTRY_DIR;
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("apply snapshots tracked files and rolls back on forced failure", async () => {
    const workspace = await scaffoldDepsWorkspace("h22-rollback");
    try {
      const planned = await createUpgradePlan({
        workspaceRoot: workspace,
        packageName: "zod",
        target: { kind: "semver-bump", bump: "patch" },
        registryDir: REGISTRY,
      });
      const packageJsonPath = join(workspace, "package.json");
      const before = readFileSync(packageJsonPath, "utf8");

      const applied = await applyUpgradePlan({
        workspaceRoot: workspace,
        planPath: join(planned.planDir!, "plan.json"),
        yes: true,
        allowScripts: false,
        skipTests: true,
        dryRun: false,
        forceFailure: true,
      });

      expect(applied.exitCode).toBe(1);
      expect(applied.rolledBack).toBe(true);
      expect(readFileSync(packageJsonPath, "utf8")).toBe(before);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("generated package upgrade registry is emitted", async () => {
    const workspace = await scaffoldDepsWorkspace("h22-registry");
    try {
      const raw = stripDeterministicHeader(
        readFileSync(join(workspace, "src", "forge", "_generated", "packageUpgradeRegistry.json"), "utf8"),
      );
      const registry = JSON.parse(raw) as { commands: string[]; planDirectory: string };
      expect(registry.planDirectory).toBe(".forge/upgrades");
      expect(registry.commands).toContain("forge deps upgrade-plan <package> --to latest");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
