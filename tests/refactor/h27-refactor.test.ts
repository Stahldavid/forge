import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runRefactorCommand } from "../../src/forge/cli/refactor.ts";
import type { RefactorCommandOptions } from "../../src/forge/refactor/types.ts";
import {
  cleanupWorkspace,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

function refactorOptions(
  workspaceRoot: string,
  overrides: Partial<RefactorCommandOptions>,
): RefactorCommandOptions {
  return {
    action: "rename",
    workspaceRoot,
    json: true,
    dryRun: false,
    plan: false,
    yes: false,
    force: false,
    allowHighRisk: false,
    noGenerate: true,
    noVerify: true,
    keepFailed: false,
    ...overrides,
  };
}

function scaffoldRefactorWorkspace(prefix: string): string {
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
          priority: "text",
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
  mkdirSync(join(root, "src", "commands"), { recursive: true });
  mkdirSync(join(root, "src", "queries"), { recursive: true });
  mkdirSync(join(root, "src", "actions"), { recursive: true });
  mkdirSync(join(root, "web", "components"), { recursive: true });
  mkdirSync(join(root, ".forge", "blueprints"), { recursive: true });
  writeFileSync(
    join(root, "src", "commands", "updateTicketPriority.ts"),
    `
      import { can, command } from "forge/server";
      export const updateTicketPriority = command({
        auth: can("tickets.update"),
        handler: async (ctx, input: { id: string; priority: string }) => {
          return ctx.db.tickets.update(input.id, { priority: input.priority });
        },
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "src", "queries", "liveTickets.ts"),
    `
      import { can, liveQuery } from "forge/server";
      export const liveTickets = liveQuery({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.where({ priority: "high" }),
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "web", "components", "PriorityBadge.tsx"),
    `
      export function PriorityBadge(props: { priority: string }) {
        return <span>{props.priority}</span>;
      }
    `,
    "utf8",
  );
  writeFileSync(
    join(root, ".forge", "blueprints", "ticket-priority.json"),
    JSON.stringify({
      schemaVersion: "0.1.0",
      name: "ticket-priority",
      changes: [
        { kind: "addField", table: "tickets", field: { name: "priority", type: "text" } },
      ],
    }),
    "utf8",
  );
  return root;
}

describe("H27 safe refactor", () => {
  test("rename field plans migration hint, dry-run leaves files untouched, apply and rollback work", async () => {
    const root = scaffoldRefactorWorkspace("h27-field");
    try {
      const dryRun = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "field",
          from: "tickets.priority",
          to: "tickets.urgency",
          dryRun: true,
        }),
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.plan?.migrationPlan?.sql[0]).toBe(
        "ALTER TABLE tickets RENAME COLUMN priority TO urgency;",
      );
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "priority",
      );

      const applied = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "field",
          from: "tickets.priority",
          to: "tickets.urgency",
          yes: true,
        }),
      );
      expect(applied.ok).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "urgency",
      );
      expect(readFileSync(join(root, "src", "queries", "liveTickets.ts"), "utf8")).toContain(
        "urgency",
      );
      expect(applied.plan?.filesToModify.some((patch) => patch.file.startsWith("src/forge/_generated"))).toBe(false);

      const rollback = await runRefactorCommand(
        refactorOptions(root, {
          action: "rollback",
          planId: applied.plan?.id,
        }),
      );
      expect(rollback.ok).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "priority",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("rename table is high risk unless explicitly allowed", async () => {
    const root = scaffoldRefactorWorkspace("h27-table");
    try {
      const blocked = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "table",
          from: "tickets",
          to: "supportTickets",
          yes: true,
        }),
      );
      expect(blocked.ok).toBe(false);
      expect(blocked.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_REFACTOR_HIGH_RISK",
      );

      const planned = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "table",
          from: "tickets",
          to: "supportTickets",
          dryRun: true,
        }),
      );
      expect(planned.plan?.migrationPlan?.sql[0]).toBe(
        "ALTER TABLE tickets RENAME TO supportTickets;",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("replace-process-env rewrites server ctx usage and rejects client files", async () => {
    const root = scaffoldRefactorWorkspace("h27-env");
    try {
      writeFileSync(
        join(root, "src", "commands", "useSecret.ts"),
        `
          import { command } from "forge/server";
          export const useSecret = command({
            handler: async (ctx) => process.env.STRIPE_SECRET_KEY,
          });
        `,
        "utf8",
      );
      const replaced = await runRefactorCommand(
        refactorOptions(root, {
          action: "replace-process-env",
          from: "STRIPE_SECRET_KEY",
          yes: true,
        }),
      );
      expect(replaced.ok).toBe(true);
      expect(readFileSync(join(root, "src", "commands", "useSecret.ts"), "utf8")).toContain(
        'ctx.secrets.get("STRIPE_SECRET_KEY")',
      );

      writeFileSync(
        join(root, "web", "components", "SecretBadge.tsx"),
        `export function SecretBadge() { return <span>{process.env.STRIPE_SECRET_KEY}</span>; }`,
        "utf8",
      );
      const client = await runRefactorCommand(
        refactorOptions(root, {
          action: "replace-process-env",
          from: "STRIPE_SECRET_KEY",
          dryRun: true,
        }),
      );
      expect(client.ok).toBe(false);
      expect(client.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_REFACTOR_SECRET_IN_CLIENT",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action removes forbidden import and creates action", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          yes: true,
        }),
      );
      expect(result.ok).toBe(true);
      expect(readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8")).not.toContain(
        'from "stripe"',
      );
      expect(readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8")).toContain(
        'ctx.emit("checkout.requested"',
      );
      expect(existsSync(join(root, "src", "actions", "createCheckoutSession.ts"))).toBe(true);
      const actionSource = readFileSync(join(root, "src", "actions", "createCheckoutSession.ts"), "utf8");
      expect(actionSource).toContain('import * as StripeIntegration from "stripe";');
      expect(actionSource).toContain("void StripeIntegration");
      expect(actionSource).toContain('integration: "stripe"');
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action refuses unsafe non-block handlers with inline fix hints", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-unsafe");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => new Stripe("sk_test").checkout.sessions.create({ mode: "payment" }),
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
      expect(result.diagnostics[0]?.fixHint).toBeTruthy();
      expect(existsSync(join(root, "src", "actions", "createCheckoutSession.ts"))).toBe(false);
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action refuses package bindings used outside the handler", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-outside-use");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          const stripeVersion = Stripe.VERSION;
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
            },
          });
          export const version = stripeVersion;
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
      expect(result.diagnostics[0]?.message).toContain("outside the extracted handler");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action refuses unused package imports instead of deleting them blindly", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-unused-import");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              return { planId: input.planId };
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
      expect(result.diagnostics[0]?.message).toContain("not referenced inside");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action is binding-aware and ignores shadowed local names", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-shadowed-import");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              const Stripe = (_key: string) => ({ checkout: { sessions: { create: async () => input.planId } } });
              return Stripe("local").checkout.sessions.create();
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
      expect(result.diagnostics[0]?.message).toContain("not referenced inside");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action ignores type-only imports as runtime extraction targets", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-type-only");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import type Stripe from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { stripe: Stripe.Checkout.SessionCreateParams }) => {
              return { planId: input.stripe.mode };
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_TARGET_NOT_FOUND");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action refuses side-effect imports with no analyzable binding", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-side-effect-import");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string }) => {
              return { planId: input.planId };
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          dryRun: true,
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("FORGE_REFACTOR_PATCH_UNSAFE");
      expect(result.diagnostics[0]?.message).toContain("side-effect import");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("extract-action preserves type-only specifiers from mixed imports", async () => {
    const root = scaffoldRefactorWorkspace("h27-extract-preserve-type-import");
    try {
      writeFileSync(
        join(root, "src", "commands", "createCheckout.ts"),
        `
          import Stripe, { type StripeConfig } from "stripe";
          import { command } from "forge/server";
          export const createCheckout = command({
            handler: async (ctx, input: { planId: string; config: StripeConfig }) => {
              const stripe = new Stripe("sk_test");
              return stripe.checkout.sessions.create({ mode: "payment" });
            },
          });
        `,
        "utf8",
      );
      const result = await runRefactorCommand(
        refactorOptions(root, {
          action: "extract-action",
          from: "createCheckout",
          packageName: "stripe",
          eventName: "checkout.requested",
          actionName: "createCheckoutSession",
          yes: true,
        }),
      );

      expect(result.ok).toBe(true);
      const commandSource = readFileSync(join(root, "src", "commands", "createCheckout.ts"), "utf8");
      expect(commandSource).toContain('import type { StripeConfig } from "stripe";');
      expect(commandSource).not.toContain("import Stripe");
      expect(commandSource).toContain("config: StripeConfig");
      expect(commandSource).toContain('ctx.emit("checkout.requested"');
    } finally {
      cleanupWorkspace(root);
    }
  });
});
