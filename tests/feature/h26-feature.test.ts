import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runFeatureCommand } from "../../src/forge/cli/feature.ts";
import type { FeatureCommandOptions } from "../../src/forge/feature/types.ts";
import {
  cleanupWorkspace,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function featureOptions(
  workspaceRoot: string,
  overrides: Partial<FeatureCommandOptions>,
): FeatureCommandOptions {
  return {
    action: "plan",
    workspaceRoot,
    json: true,
    dryRun: false,
    yes: false,
    noGenerate: true,
    noVerify: true,
    keepFailed: false,
    update: false,
    allowHighRisk: false,
    ...overrides,
  };
}

function scaffoldFeatureWorkspace(prefix: string): string {
  const root = scaffoldGenerateWorkspace(prefix);
  writeFileSync(
    join(root, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tenants = defineTable({
        name: "tenants",
        fields: { id: "uuid", name: "text" },
      });
      export const tickets = defineTable({
        name: "tickets",
        fields: {
          id: "uuid",
          tenantId: "ref:tenants",
          title: "text",
          status: "text",
        },
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "tickets.read": canRole("owner", "admin", "member"),
        "tickets.update": canRole("owner", "admin", "member"),
      });
    `,
    "utf8",
  );
  mkdirSync(join(root, ".forge", "blueprints"), { recursive: true });
  mkdirSync(join(root, "src", "commands"), { recursive: true });
  mkdirSync(join(root, "src", "queries"), { recursive: true });
  return root;
}

function writeBlueprint(root: string, name: string, blueprint: unknown): string {
  const file = join(".forge", "blueprints", `${name}.json`);
  writeFileSync(join(root, file), JSON.stringify(blueprint, null, 2), "utf8");
  return file.replace(/\\/g, "/");
}

const invoicesBlueprint = {
  schemaVersion: "0.1.0",
  name: "invoices",
  description: "Add invoices resource.",
  mode: "create",
  resources: [
    {
      name: "invoices",
      tenantScoped: true,
      fields: [
        { name: "amount", type: "number", required: true },
        {
          name: "status",
          type: "enum",
          values: ["draft", "paid", "void"],
          default: "draft",
          indexed: true,
        },
      ],
      crud: true,
      liveQuery: true,
      react: true,
      tests: true,
    },
  ],
};

describe("H26 feature blueprints", () => {
  test("validates invalid blueprints with diagnostics", async () => {
    const root = scaffoldFeatureWorkspace("h26-invalid");
    try {
      const path = writeBlueprint(root, "bad", {
        schemaVersion: "0.1.0",
        name: "bad",
        resources: [
          {
            name: "badThings",
            fields: [{ name: "wat", type: "money" }],
          },
        ],
      });
      const result = await runFeatureCommand(
        featureOptions(root, { action: "validate", blueprintPath: path }),
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_FEATURE_BLUEPRINT_INVALID",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("plans deterministic resource changes without writing source files", async () => {
    const root = scaffoldFeatureWorkspace("h26-plan");
    try {
      const path = writeBlueprint(root, "invoices", invoicesBlueprint);
      const first = await runFeatureCommand(
        featureOptions(root, { action: "plan", blueprintPath: path }),
      );
      const second = await runFeatureCommand(
        featureOptions(root, { action: "plan", blueprintPath: path }),
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.plan?.id).toBe("invoices");
      expect(first.plan?.blueprintHash).toBe(second.plan?.blueprintHash);
      expect(first.plan?.filesToCreate.map((file) => file.file)).toContain(
        "src/commands/createInvoice.ts",
      );
      expect(existsSync(join(root, "src", "commands", "createInvoice.ts"))).toBe(false);
      expect(existsSync(join(root, ".forge", "features", "plans", "invoices", "plan.json"))).toBe(true);
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("applies, no-ops on same hash, rejects changed hash, and rolls back", async () => {
    const root = scaffoldFeatureWorkspace("h26-apply");
    try {
      const path = writeBlueprint(root, "invoices", invoicesBlueprint);
      const applied = await runFeatureCommand(
        featureOptions(root, {
          action: "apply",
          blueprintPath: path,
          yes: true,
          noGenerate: false,
        }),
      );

      expect(applied.ok).toBe(true);
      expect(existsSync(join(root, "src", "commands", "createInvoice.ts"))).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        'name: "invoices"',
      );
      expect(existsSync(join(root, ".forge", "features", "applied", "invoices.json"))).toBe(true);

      const again = await runFeatureCommand(
        featureOptions(root, {
          action: "apply",
          blueprintPath: path,
          yes: true,
        }),
      );
      expect(again.ok).toBe(true);
      expect(again.explanation).toContain("already applied");

      const changedPath = writeBlueprint(root, "invoices-changed", {
        ...invoicesBlueprint,
        description: "Changed invoice feature.",
      });
      const changed = await runFeatureCommand(
        featureOptions(root, {
          action: "apply",
          blueprintPath: changedPath,
          yes: true,
        }),
      );
      expect(changed.ok).toBe(false);
      expect(changed.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_FEATURE_HASH_MISMATCH",
      );

      const rollback = await runFeatureCommand(
        featureOptions(root, { action: "rollback", featureId: "invoices" }),
      );
      expect(rollback.ok).toBe(true);
      expect(existsSync(join(root, "src", "commands", "createInvoice.ts"))).toBe(false);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).not.toContain(
        'name: "invoices"',
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("writes blueprint examples", async () => {
    const root = scaffoldFeatureWorkspace("h26-examples");
    try {
      const output = ".forge/blueprints/invoices.json";
      const result = await runFeatureCommand(
        featureOptions(root, {
          action: "examples",
          exampleName: "invoices",
          writePath: output,
        }),
      );
      expect(result.ok).toBe(true);
      expect(result.examples).toContain("invoices");
      expect(JSON.parse(readFileSync(join(root, output), "utf8")).name).toBe("invoices");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
