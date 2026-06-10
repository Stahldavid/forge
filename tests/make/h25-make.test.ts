import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runMakeCommand } from "../../src/forge/cli/make.ts";
import type { MakeCommandOptions } from "../../src/forge/make/types.ts";
import {
  cleanupWorkspace,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function makeOptions(
  workspaceRoot: string,
  overrides: Partial<MakeCommandOptions>,
): MakeCommandOptions {
  return {
    primitive: "resource",
    workspaceRoot,
    json: true,
    dryRun: false,
    plan: false,
    apply: false,
    yes: false,
    force: false,
    noGenerate: true,
    noVerify: true,
    keepFailed: false,
    tenantScoped: true,
    fieldSpecs: [],
    index: false,
    withAi: false,
    withCrud: false,
    withLiveQuery: false,
    withReact: false,
    withTests: false,
    withCreateForm: false,
    ...overrides,
  };
}

function scaffoldMakeWorkspace(prefix: string): string {
  const root = scaffoldGenerateWorkspace(prefix);
  writeFileSync(
    join(root, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tenants = defineTable({
        name: "tenants",
        fields: { id: "uuid", name: "text" },
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "tenants.read": canRole("owner", "admin", "member"),
      });
    `,
    "utf8",
  );
  mkdirSync(join(root, "src", "commands"), { recursive: true });
  mkdirSync(join(root, "src", "queries"), { recursive: true });
  return root;
}

describe("H25 forge make", () => {
  test("lists and explains make primitives", async () => {
    const root = scaffoldMakeWorkspace("h25-list");
    try {
      const list = await runMakeCommand(makeOptions(root, { primitive: "list" }));
      expect(list.ok).toBe(true);
      expect(list.primitives).toContain("resource");

      const explain = await runMakeCommand(
        makeOptions(root, {
          primitive: "explain",
          explainPrimitive: "resource",
        }),
      );
      expect(explain.ok).toBe(true);
      expect(explain.explanation).toContain("full resource slice");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("creates a deterministic dry-run resource plan without writing source files", async () => {
    const root = scaffoldMakeWorkspace("h25-dry-run");
    try {
      const result = await runMakeCommand(
        makeOptions(root, {
          name: "invoices",
          fieldsRaw: "amount:number,status:enum(draft,paid):default=draft:index",
          dryRun: true,
          plan: true,
          withReact: true,
        }),
      );

      expect(result.ok).toBe(true);
      expect(result.plan?.id).toMatch(/^make_/);
      expect(result.plan?.filesToCreate.map((file) => file.file)).toContain(
        "src/commands/createInvoice.ts",
      );
      expect(result.plan?.filesToModify.map((file) => file.file)).toContain(
        "src/forge/schema.ts",
      );
      expect(result.planPath).toBeDefined();
      expect(existsSync(join(root, result.planPath ?? ""))).toBe(true);
      expect(existsSync(join(root, "src", "commands", "createInvoice.ts"))).toBe(false);
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("applies a resource, generates make registry, and rolls back source files", async () => {
    const root = scaffoldMakeWorkspace("h25-apply");
    try {
      const applied = await runMakeCommand(
        makeOptions(root, {
          name: "invoices",
          fieldsRaw: "amount:number,status:enum(draft,paid):default=draft:index",
          apply: true,
          yes: true,
          plan: true,
          withReact: true,
          withTests: true,
          noGenerate: false,
        }),
      );

      expect(applied.ok).toBe(true);
      expect(applied.applied).toBe(true);
      expect(existsSync(join(root, "src", "commands", "createInvoice.ts"))).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        'name: "invoices"',
      );
      expect(readFileSync(join(root, "src", "policies.ts"), "utf8")).toContain(
        '"invoices.read"',
      );

      const makeRegistry = JSON.parse(
        stripDeterministicHeader(
          readFileSync(join(root, "src", "forge", "_generated", "makeRegistry.json"), "utf8"),
        ),
      ) as { primitives: Array<{ name: string }> };
      expect(makeRegistry.primitives.map((primitive) => primitive.name)).toContain("resource");

      const inspect = await runInspectCommand("make", root);
      expect(inspect.exitCode).toBe(0);

      const rollback = await runMakeCommand(
        makeOptions(root, {
          primitive: "rollback",
          name: applied.plan?.id,
        }),
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
});
