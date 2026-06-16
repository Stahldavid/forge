import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_AI_FORBIDDEN_CONTEXT,
  FORGE_QUERY_AI_FORBIDDEN,
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_SECRET_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
  FORGE_SECRET_FORBIDDEN_CONTEXT,
} from "../../src/forge/compiler/diagnostics/codes.ts";
import { runCheckCommand } from "../../src/forge/cli/commands.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("security assurance: runtime boundaries", () => {
  test("bad command and query fixtures fail with boundary diagnostics", async () => {
    const workspace = scaffoldGenerateWorkspace("security-runtime-boundaries");
    writeFileSync(
      join(workspace, "src", "forge", "commands.ts"),
      `
        import { command } from "forge/server";

        export const badAiCommand = command({
          handler: async (ctx) => {
            await ctx.ai.generateText({
              provider: "openai",
              model: "gpt-4o-mini",
              prompt: "should be blocked",
            });
          },
        });

        export const badAgentCommand = command({
          handler: async (ctx) => {
            await ctx.agent.run({
              provider: "gateway",
              model: "openai/gpt-5.4",
              instructions: "should be blocked",
              prompt: "should be blocked",
            });
          },
        });
      `,
      "utf8",
    );
    writeFileSync(
      join(workspace, "src", "forge", "queries.ts"),
      `
        import { query } from "forge/server";

        export const badWriteQuery = query({
          handler: async (ctx) => {
            await ctx.db.users.insert({ name: "blocked" });
            return [];
          },
        });

        export const badEmitQuery = query({
          handler: async (ctx) => {
            await ctx.emit("blocked", {});
            return [];
          },
        });

        export const badSecretQuery = query({
          handler: async (ctx) => {
            return ctx.secrets.get("OPENAI_API_KEY");
          },
        });

        export const badAiQuery = query({
          handler: async (ctx) => {
            return ctx.ai.generateText({
              provider: "openai",
              model: "gpt-4o-mini",
              prompt: "blocked",
            });
          },
        });
      `,
      "utf8",
    );

    try {
      const generated = await run(defaultGenerateOptions(workspace));
      expect(generated.exitCode).toBe(0);

      const checked = await runCheckCommand(workspace);
      const codes = checked.errors.map((diagnostic) => diagnostic.code);
      expect(codes).toContain(FORGE_AI_FORBIDDEN_CONTEXT);
      expect(codes).toContain(FORGE_QUERY_WRITE_FORBIDDEN);
      expect(codes).toContain(FORGE_QUERY_EMIT_FORBIDDEN);
      expect(codes).toContain(FORGE_QUERY_SECRET_FORBIDDEN);
      expect(codes).toContain(FORGE_QUERY_AI_FORBIDDEN);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("command runtime cannot resolve secrets even if a handler reaches ctx.secrets", () => {
    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => "sk_forge_security_canary",
        snapshot: () => ({ OPENAI_API_KEY: "sk_forge_security_canary" }),
      },
      registryNames: new Set(["OPENAI_API_KEY"]),
      runtimeKind: "command",
    });

    expect(() => secrets.get("OPENAI_API_KEY")).toThrow();
    try {
      secrets.get("OPENAI_API_KEY");
    } catch (error) {
      expect((error as Error & { code?: string }).code).toBe(
        FORGE_SECRET_FORBIDDEN_CONTEXT,
      );
    }
  });
});
