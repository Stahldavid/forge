import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runDoctorCommand } from "../../src/forge/cli/doctor.ts";
import { runGenerateCommand, runInspectCommand } from "../../src/forge/cli/commands.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import type { AgentCapabilityMap } from "../../src/forge/compiler/agent-contract/types.ts";
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
      const all = await runInspectCommand("all", project);
      expect((all.data as { capabilityMap?: unknown }).capabilityMap).toBeTruthy();
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
