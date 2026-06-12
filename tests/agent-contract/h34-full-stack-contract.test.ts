import { join } from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { run as runGenerate } from "../../src/forge/compiler/orchestrator/run.ts";
import { runNewCommand } from "../../src/forge/cli/new.ts";
import type { AgentContract } from "../../src/forge/compiler/agent-contract/types.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  tempWorkspace,
} from "../orchestrator/helpers.ts";

function readContract(project: string): AgentContract {
  const raw = stripDeterministicHeader(
    readFileSync(
      join(project, "src", "forge", "_generated", "agentContract.json"),
      "utf8",
    ),
  );
  return JSON.parse(raw) as AgentContract;
}

describe("H34 full-stack contract", () => {
  test("agentContract links frontend routes to hooks, policies, tables, and events", async () => {
    const workspace = tempWorkspace("h34-full-stack");
    try {
      const created = await runNewCommand({
        name: "notes-app",
        template: "minimal-web",
        packageManager: "bun",
        install: false,
        git: false,
        workspaceRoot: workspace,
      });
      expect(created.exitCode).toBe(0);
      const project = join(workspace, "notes-app");
      await runGenerate(defaultGenerateOptions(project));

      const contract = readContract(project);
      const createNote = contract.commands.find((entry) => entry.name === "createNote");
      const listNotes = contract.queries.find((entry) => entry.name === "listNotes");
      const liveNotes = contract.liveQueries.find((entry) => entry.name === "liveNotes");
      expect(createNote?.policy).toBe("notes.create");
      expect(createNote?.tablesWritten).toEqual(["notes"]);
      expect(createNote?.emits).toEqual(["note.created"]);
      expect(listNotes?.policy).toBe("notes.read");
      expect(listNotes?.tablesRead).toEqual(["notes"]);
      expect(liveNotes?.tablesRead).toEqual(["notes"]);
      expect(liveNotes?.dependencies).toEqual([{ table: "notes", scope: "global" }]);

      const routeBindings = contract.frontend.routeBindings;
      expect(routeBindings.length).toBeGreaterThanOrEqual(2);
      expect(routeBindings).toContainEqual(
        expect.objectContaining({
          route: "/",
          kind: "command",
          name: "createNote",
          hook: "useCommand(api.commands.createNote)",
          policy: "notes.create",
          tablesWritten: ["notes"],
          emits: ["note.created"],
        }),
      );
      expect(routeBindings).toContainEqual(
        expect.objectContaining({
          route: "/",
          kind: "liveQuery",
          name: "liveNotes",
          hook: "useLiveQuery(api.liveQueries.liveNotes, args)",
          policy: "notes.read",
          tablesRead: ["notes"],
          dependencies: [{ table: "notes", scope: "global" }],
        }),
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
