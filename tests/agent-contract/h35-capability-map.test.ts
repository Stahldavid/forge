import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runDoctorCommand } from "../../src/forge/cli/doctor.ts";
import { runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import type { AgentCapabilityMap, AgentContract } from "../../src/forge/compiler/agent-contract/types.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

const GENERATED = "src/forge/_generated";

function readCapabilityMap(project: string): AgentCapabilityMap {
  return JSON.parse(
    stripDeterministicHeader(
      readFileSync(join(project, GENERATED, "capabilityMap.json"), "utf8"),
    ),
  ) as AgentCapabilityMap;
}

function readAgentContract(project: string): AgentContract {
  return JSON.parse(
    stripDeterministicHeader(
      readFileSync(join(project, GENERATED, "agentContract.json"), "utf8"),
    ),
  ) as AgentContract;
}

async function createMinimalProject(name: string): Promise<{ workspace: string; project: string }> {
  const workspace = tempWorkspace(name);
  const created = await runNewCommand({
    name: "notes-app",
    template: "minimal-web",
    packageManager: "bun",
    install: false,
    git: false,
    workspaceRoot: workspace,
  });
  expect(created.exitCode).toBe(0);
  return { workspace, project: join(workspace, "notes-app") };
}

describe("H35 capability map", () => {
  test("generates UI-runtime capability map from full-stack contract", async () => {
    const { workspace, project } = await createMinimalProject("h35-capability-map");
    try {
      const generated = await runGenerateCommand(defaultGenerateOptions(project));
      expect(generated.exitCode).toBe(0);
      expect(existsSync(join(project, GENERATED, "capabilityMap.json"))).toBe(true);
      expect(existsSync(join(project, GENERATED, "capabilityMap.ts"))).toBe(true);
      expect(existsSync(join(project, GENERATED, "capabilityMap.md"))).toBe(true);

      const map = readCapabilityMap(project);
      expect(map.summary.covered).toBeGreaterThanOrEqual(2);
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          status: "covered",
          userAction: "/ uses command createNote",
          runtime: expect.objectContaining({
            kind: "command",
            name: "createNote",
            policy: "notes.create",
            tablesWritten: ["notes"],
            emits: ["note.created"],
          }),
        }),
      );
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          status: "covered",
          userAction: "/ uses liveQuery liveNotes",
          runtime: expect.objectContaining({
            kind: "liveQuery",
            name: "liveNotes",
            policy: "notes.read",
            tablesRead: ["notes"],
          }),
        }),
      );
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          id: "runtime:query:listNotes",
          status: "backend-only",
        }),
      );

      const inspected = await runInspectCommand("capability-map", project);
      expect(inspected.exitCode).toBe(0);
      expect((inspected.data as { summary?: unknown }).summary).toBeTruthy();
      const naturalAlias = await runInspectCommand("capabilities", project);
      expect(naturalAlias.exitCode).toBe(0);
      expect((naturalAlias.data as { entries?: unknown[] }).entries?.length).toBeGreaterThan(0);
      const all = await runInspectCommand("all", project, { full: true });
      expect((all.data as { capabilityMap?: unknown }).capabilityMap).toBeTruthy();
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("capability map marks camelCase tenant-scoped liveQuery dependencies as tenant", async () => {
    const { workspace, project } = await createMinimalProject("h35-capability-tenant-camel-table");
    try {
      writeFileSync(
        join(project, "src", "forge", "schema.ts"),
        [
          readFileSync(join(project, "src", "forge", "schema.ts"), "utf8"),
          "",
          "export const onboardingTasks = defineTable({",
          '  name: "onboardingTasks",',
          "  fields: {",
          '    id: "uuid",',
          '    tenantId: "text",',
          '    title: "text",',
          '    status: "text",',
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "liveOnboardingTasks.ts"),
        [
          'import { can, liveQuery } from "forge/server";',
          "",
          "export const liveOnboardingTasks = liveQuery({",
          '  auth: can("tasks.read"),',
          "  handler: async (ctx) => {",
          "    return ctx.db.onboardingTasks.all();",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "listOnboardingTasks.ts"),
        [
          'import { can, query } from "forge/server";',
          "",
          "export const listOnboardingTasks = query({",
          '  auth: can("tasks.read"),',
          "  handler: async (ctx) => {",
          "    const { onboardingTasks: tasks } = ctx.db;",
          "    return tasks.where({ status: 'open' });",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      mkdirSync(join(project, "src", "commands"), { recursive: true });
      writeFileSync(
        join(project, "src", "commands", "completeOnboardingTask.ts"),
        [
          'import { can, command } from "forge/server";',
          "",
          "export const completeOnboardingTask = command({",
          '  auth: can("tasks.update"),',
          "  handler: async (ctx, args: { id: string }) => {",
          "    const tasks = ctx.db.onboardingTasks;",
          "    const current = await tasks.get(args.id);",
          "    await tasks.update(args.id, { status: 'done' });",
          "    return current;",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await runGenerateCommand(defaultGenerateOptions(project));
      expect(generated.exitCode).toBe(0);

      const contract = readAgentContract(project);
      expect(contract.data.tables).toContainEqual(
        expect.objectContaining({
          name: "onboardingTasks",
          tenantScoped: true,
          tenantField: "tenantId",
        }),
      );
      expect(contract.liveQueries.find((entry) => entry.name === "liveOnboardingTasks")?.dependencies).toEqual([
        { table: "onboardingTasks", scope: "tenant" },
      ]);
      expect(contract.queries.find((entry) => entry.name === "listOnboardingTasks")?.tablesRead).toEqual([
        "onboardingTasks",
      ]);
      expect(contract.commands.find((entry) => entry.name === "completeOnboardingTask")).toMatchObject({
        tablesRead: ["onboardingTasks"],
        tablesWritten: ["onboardingTasks"],
      });

      const map = readCapabilityMap(project);
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          id: "runtime:liveQuery:liveOnboardingTasks",
          status: "backend-only",
          runtime: expect.objectContaining({
            dependencies: [{ table: "onboardingTasks", scope: "tenant" }],
          }),
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("capability map resolves camelCase db aliases for snake_case tables", async () => {
    const { workspace, project } = await createMinimalProject("h35-capability-snake-table-aliases");
    try {
      writeFileSync(
        join(project, "src", "forge", "schema.ts"),
        [
          readFileSync(join(project, "src", "forge", "schema.ts"), "utf8"),
          "",
          "export const organizations = defineTable({",
          '  name: "organizations",',
          "  fields: {",
          '    id: "uuid",',
          '    name: "text",',
          "  },",
          "});",
          "",
          "export const accessRequests = defineTable({",
          '  name: "access_requests",',
          "  fields: {",
          '    id: "uuid",',
          '    tenantId: "ref:organizations",',
          '    title: "text",',
          '    status: "text",',
          "  },",
          "});",
          "",
          "export const evidenceDocuments = defineTable({",
          '  name: "evidence_documents",',
          "  fields: {",
          '    id: "uuid",',
          '    tenantId: "ref:organizations",',
          '    requestId: "ref:accessRequests",',
          '    title: "text",',
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "listAccessRequests.ts"),
        [
          'import { can, query } from "forge/server";',
          "",
          "export const listAccessRequests = query({",
          '  auth: can("access:read"),',
          "  handler: async (ctx) => {",
          "    const requests = await ctx.db.accessRequests.where({ tenantId: ctx.auth?.tenantId ?? 'org-acme' });",
          "    const documents = await ctx.db.evidenceDocuments.where({ requestId: requests[0]?.id ?? 'req-none' });",
          "    return { requests, documents };",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "liveAccessRequests.ts"),
        [
          'import { can, liveQuery } from "forge/server";',
          "",
          "export const liveAccessRequests = liveQuery({",
          '  auth: can("access:read"),',
          "  handler: async (ctx) => {",
          "    const { accessRequests, evidenceDocuments } = ctx.db;",
          "    const requests = await accessRequests.all();",
          "    const documents = await evidenceDocuments.all();",
          "    return { requests, documents };",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await runGenerateCommand(defaultGenerateOptions(project));
      expect(generated.exitCode).toBe(0);

      const contract = readAgentContract(project);
      expect(contract.data.tables).toContainEqual(
        expect.objectContaining({
          name: "access_requests",
          tenantScoped: true,
        }),
      );
      expect(contract.data.tables).toContainEqual(
        expect.objectContaining({
          name: "evidence_documents",
          tenantScoped: true,
        }),
      );
      expect(contract.queries.find((entry) => entry.name === "listAccessRequests")?.tablesRead).toEqual(
        expect.arrayContaining(["access_requests", "evidence_documents"]),
      );
      expect(contract.liveQueries.find((entry) => entry.name === "liveAccessRequests")?.tablesRead).toEqual(
        expect.arrayContaining(["access_requests", "evidence_documents"]),
      );

      const map = readCapabilityMap(project);
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          id: "runtime:query:listAccessRequests",
          runtime: expect.objectContaining({
            tablesRead: expect.arrayContaining(["access_requests", "evidence_documents"]),
          }),
        }),
      );
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          id: "runtime:liveQuery:liveAccessRequests",
          runtime: expect.objectContaining({
            tablesRead: expect.arrayContaining(["access_requests", "evidence_documents"]),
          }),
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("agent contract includes table reads performed by imported local helpers", async () => {
    const { workspace, project } = await createMinimalProject("h35-capability-helper-reads");
    try {
      writeFileSync(
        join(project, "src", "forge", "schema.ts"),
        [
          readFileSync(join(project, "src", "forge", "schema.ts"), "utf8"),
          "",
          "export const organizations = defineTable({",
          '  name: "organizations",',
          "  fields: {",
          '    id: "uuid",',
          '    name: "text",',
          "  },",
          "});",
          "",
          "export const projects = defineTable({",
          '  name: "projects",',
          "  fields: {",
          '    id: "uuid",',
          '    organizationId: "text",',
          '    name: "text",',
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      mkdirSync(join(project, "src", "authz"), { recursive: true });
      writeFileSync(
        join(project, "src", "authz", "membership.ts"),
        [
          "export async function requireMembership(ctx: { db: any; auth?: { tenantId?: string } }) {",
          '  const organizationId = ctx.auth?.tenantId ?? "org-acme";',
          "  const organization = await ctx.db.organizations.get(organizationId);",
          "  if (!organization) {",
          '    throw new Error("organization membership required");',
          "  }",
          "  return organization;",
          "}",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "listProjects.ts"),
        [
          'import { can, query } from "forge/server";',
          'import { requireMembership } from "../authz/membership";',
          "",
          "export const listProjects = query({",
          '  auth: can("projects.read"),',
          "  handler: async (ctx) => {",
          "    await requireMembership(ctx);",
          "    return ctx.db.projects.all();",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );
      writeFileSync(
        join(project, "src", "queries", "liveProjects.ts"),
        [
          'import { can, liveQuery } from "forge/server";',
          'import { requireMembership } from "../authz/membership";',
          "",
          "export const liveProjects = liveQuery({",
          '  auth: can("projects.read"),',
          "  handler: async (ctx) => {",
          "    await requireMembership(ctx);",
          "    return ctx.db.projects.where({ organizationId: ctx.auth?.tenantId ?? 'org-acme' });",
          "  },",
          "});",
          "",
        ].join("\n"),
        "utf8",
      );

      const generated = await runGenerateCommand(defaultGenerateOptions(project));
      expect(generated.exitCode).toBe(0);

      const contract = readAgentContract(project);
      expect(contract.queries.find((entry) => entry.name === "listProjects")?.tablesRead).toEqual([
        "organizations",
        "projects",
      ]);
      expect(contract.liveQueries.find((entry) => entry.name === "liveProjects")?.tablesRead).toEqual([
        "organizations",
        "projects",
      ]);

      const map = readCapabilityMap(project);
      expect(map.entries).toContainEqual(
        expect.objectContaining({
          id: "runtime:query:listProjects",
          runtime: expect.objectContaining({
            tablesRead: ["organizations", "projects"],
          }),
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("capability map reports raw runtime fetch warnings", async () => {
    const { workspace, project } = await createMinimalProject("h35-capability-raw-fetch");
    try {
      const appPath = join(project, "web", "src", "App.tsx");
      writeFileSync(
        appPath,
        `${readFileSync(appPath, "utf8")}\nvoid fetch('/commands/createNote');\n`,
        "utf8",
      );
      const generated = await runGenerateCommand(defaultGenerateOptions(project));
      expect(generated.exitCode).toBe(0);

      const map = readCapabilityMap(project);
      expect(map.summary.warnings).toBeGreaterThanOrEqual(1);
      expect(map.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_CAPABILITY_RAW_RUNTIME_FETCH",
      );
      expect(map.entries.some((entry) => entry.status === "warning")).toBe(true);

      const doctor = await runDoctorCommand({ workspaceRoot: project });
      expect(doctor.checks.some((check) => check.name.startsWith("capability-diagnostic-"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
