import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { hasUnknownOption, parseCli } from "../../src/forge/cli/parse.ts";
import { formatCairHuman, runCairCommand } from "../../src/forge/cair/index.ts";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function scaffoldCairWorkspace(): string {
  const workspace = mkdtempSync(join(tmpdir(), "forge-cair-"));
  const generated = join(workspace, "src", "forge", "_generated");
  mkdirSync(generated, { recursive: true });
  const commandSource = "export function createTicket() {\n  return true;\n}\n";
  const commandDir = join(workspace, "src", "commands");
  mkdirSync(commandDir, { recursive: true });
  writeFileSync(join(commandDir, "createTicket.ts"), commandSource, "utf8");
  writeFileSync(join(commandDir, "useTicket.ts"), "import { createTicket } from \"./createTicket\";\nexport const used = createTicket();\n", "utf8");
  writeJson(join(workspace, "package.json"), {
    name: "cair-fixture",
    version: "1.0.0",
    type: "module",
    forge: { sourceRoots: ["src"] },
  });
  writeJson(join(generated, "appGraph.json"), {
    schemaVersion: "0.1.0",
    generatorVersion: "test",
    analyzerVersion: "test",
    inputHash: "input",
    symbols: [
      {
        id: "command:createTicket",
        kind: "command",
        name: "createTicket",
        qualifiedName: "commands.createTicket",
        file: "src/commands/createTicket.ts",
        span: { start: 0, end: commandSource.length },
        contentHash: hashText(commandSource),
        meta: {},
      },
    ],
    edges: [],
    moduleGraph: {
      nodes: [
        {
          id: "module:createTicket",
          file: "src/commands/createTicket.ts",
          directPackageImports: [
            {
              specifier: "Stripe",
              packageName: "stripe",
              subpath: ".",
              span: { start: 1, end: 9 },
              importKind: "static",
            },
          ],
          localImports: [],
          declaredContexts: [],
          effectiveContexts: [],
        },
        {
          id: "module:useTicket",
          file: "src/commands/useTicket.ts",
          directPackageImports: [],
          localImports: [
            {
              specifier: "./createTicket",
              resolvedFile: "src/commands/createTicket.ts",
              span: { start: 0, end: 45 },
              importKind: "static",
            },
          ],
          declaredContexts: [],
          effectiveContexts: [],
        },
      ],
    },
    diagnostics: [],
  });
  writeJson(join(generated, "packageGraph.json"), {
    schemaVersion: "0.1.0",
    generatorVersion: "test",
    analyzerVersion: "test",
    packages: [
      {
        name: "stripe",
        version: "18.0.0",
        packageManager: "bun",
        resolutionMode: "node",
        entrypoints: [
          {
            subpath: ".",
            conditions: [],
            patternBacked: false,
            dtsPath: "node_modules/stripe/index.d.ts",
            exports: [
              {
                name: "Stripe",
                kind: "class",
                signature: "class Stripe",
                classification: {
                  alias: "Stripe",
                  packageName: "stripe",
                  entrypoint: ".",
                  exportName: "Stripe",
                  compatible: ["node"],
                  incompatible: [],
                  capabilities: {},
                },
                jsdoc: null,
                examples: [],
              },
            ],
          },
        ],
        source: "static",
        contentChecksum: "pkg-hash",
      },
    ],
  });
  writeJson(join(generated, "testGraph.json"), {
    schemaVersion: "0.1.0",
    generatorVersion: "test",
    analyzerVersion: "test",
    inputHash: "input",
    tests: [
      {
        file: "tests/commands/create-ticket.test.ts",
        kind: "unit",
        cost: "fast",
        confidence: "confirmed",
        covers: {
          commands: ["createTicket"],
          queries: [],
          liveQueries: [],
          actions: [],
          workflows: [],
          tables: [],
          policies: [],
          components: [],
          packages: ["stripe"],
        },
        reasons: ["fixture"],
      },
    ],
    diagnostics: [],
  });
  return workspace;
}

describe("CAIR", () => {
  test("parseCli accepts CAIR snapshot and query commands", () => {
    expect(hasUnknownOption(["cair", "snapshot", "--format", "json"])).toBeNull();

    const snapshot = parseCli(["cair", "snapshot", "--format", "json"]);
    expect(snapshot.errors).toEqual([]);
    expect(snapshot.command).toMatchObject({
      kind: "cair",
      options: {
        subcommand: "snapshot",
        format: "json",
      },
    });

    const query = parseCli(["cair", "query", "Q", "STATUS", "--json"]);
    expect(query.errors).toEqual([]);
    expect(query.command).toMatchObject({
      kind: "cair",
      options: {
        subcommand: "query",
        query: "Q STATUS",
        json: true,
      },
    });

    const action = parseCli(["cair", "action", "--dry-run", "A", "CREATE.FILE", "path=src/example.ts"]);
    expect(action.errors).toEqual([]);
    expect(action.command).toMatchObject({
      kind: "cair",
      options: {
        subcommand: "action",
        action: "A CREATE.FILE path=src/example.ts",
        dryRun: true,
      },
    });

    const plan = parseCli(["cair", "action", "--plan", "A", "CREATE.FILE", "path=src/example.ts"]);
    expect(plan.errors).toEqual([]);
    expect(plan.command).toMatchObject({
      kind: "cair",
      options: {
        subcommand: "action",
        action: "A CREATE.FILE path=src/example.ts",
        plan: true,
      },
    });
  });

  test("snapshot and queries project Forge graphs into compact observations", () => {
    const workspace = scaffoldCairWorkspace();
    try {
      const snapshot = runCairCommand({
        subcommand: "snapshot",
        workspaceRoot: workspace,
        json: false,
        format: "text",
      });
      expect(snapshot.exitCode).toBe(0);
      expect(snapshot.snapshot.summary).toMatchObject({
        modules: 2,
        symbols: 1,
        packages: 1,
        apis: 1,
        tests: 1,
      });
      expect(formatCairHuman(snapshot)).toContain("@cair 0.5.0 snapshot=");

      const api = runCairCommand({
        subcommand: "query",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        query: "Q DEP.API package=stripe symbol=Stripe",
      });
      expect(api.exitCode).toBe(0);
      expect(api.observations[0]?.text).toContain("API#1 package=stripe");

      const tests = runCairCommand({
        subcommand: "query",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        query: "Q TESTS S#1",
      });
      expect(tests.exitCode).toBe(0);
      expect(tests.observations[0]?.text).toContain("tests=T#1");

      const refs = runCairCommand({
        subcommand: "query",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        query: "Q R S#1",
      });
      expect(refs.exitCode).toBe(0);
      expect(refs.observations[0]?.code).toBe("O REFS");
      expect(refs.observations[0]?.text).toContain("matches=");

      const def = runCairCommand({
        subcommand: "query",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        query: "Q D S#1",
      });
      expect(def.exitCode).toBe(0);
      expect(def.observations[0]?.code).toBe("O DEF");
      expect(def.observations[0]?.data?.declaration).toContain("function createTicket");

      const impact = runCairCommand({
        subcommand: "query",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        query: "Q I S#1",
      });
      expect(impact.exitCode).toBe(0);
      expect(impact.observations[0]?.text).toContain("tests=T#1");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("action plans can be persisted and applied later", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "planned.ts");
    try {
      const planned = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A CF p=src/planned.ts",
          "<<CODE",
          "export const planned = true;",
          "CODE",
        ].join("\n"),
        plan: true,
      });
      expect(planned.exitCode).toBe(0);
      expect(planned.action?.planPaths[0]).toBeTruthy();
      expect(planned.observations.some((item) => item.code === "O PLAN")).toBe(true);
      expect(existsSync(target)).toBe(false);

      const applied = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: `A APPLY plan=${planned.action?.planPaths[0]}`,
      });
      expect(applied.exitCode).toBe(0);
      expect(applied.observations.some((item) => item.code === "O APPLY.APPLIED")).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("export const planned = true;");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions create files with dry-run, apply, and journal observations", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "newAction.ts");
    try {
      const script = [
        "A CREATE.FILE path=src/newAction.ts",
        "<<CODE",
        "export const createdByCair = true;",
        "CODE",
      ].join("\n");

      const planned = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: script,
        dryRun: true,
      });
      expect(planned.exitCode).toBe(0);
      expect(planned.observations.some((item) => item.code === "O ACTION.PLAN")).toBe(true);
      expect(planned.observations.some((item) => item.code === "O FILE.PLAN")).toBe(true);
      expect(existsSync(target)).toBe(false);

      const applied = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: script,
      });
      expect(applied.exitCode).toBe(0);
      expect(readFileSync(target, "utf8")).toBe("export const createdByCair = true;");
      expect(applied.observations.some((item) => item.code === "O ACTION.PLAN")).toBe(true);
      expect(applied.observations.some((item) => item.code === "O JOURNAL")).toBe(true);
      const journalPath = applied.action?.journalPaths[0];
      expect(journalPath ? existsSync(join(workspace, journalPath)) : false).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions reject stale snapshot headers", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "stale.ts");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "@cair 0.5 snapshot=stale",
          "A CREATE.FILE path=src/stale.ts",
          "<<CODE",
          "export const stale = true;",
          "CODE",
        ].join("\n"),
      });
      expect(result.exitCode).toBe(1);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions rollback journaled file creation", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "rollback.ts");
    try {
      const applied = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A CREATE.FILE path=src/rollback.ts",
          "<<CODE",
          "export const rollback = true;",
          "CODE",
        ].join("\n"),
      });
      const journal = applied.action?.journalPaths[0];
      expect(applied.exitCode).toBe(0);
      expect(existsSync(target)).toBe(true);
      expect(journal).toBeTruthy();

      const rolledBack = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: `A ROLLBACK journal=${journal}`,
      });
      expect(rolledBack.exitCode).toBe(0);
      expect(rolledBack.observations.some((item) => item.code === "O ROLLBACK.APPLIED")).toBe(true);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions patch files only when span hash matches", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "patchTarget.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    const original = "export const value = 1;\n";
    writeFileSync(target, original, "utf8");
    const start = original.indexOf("1");
    const end = start + 1;
    try {
      const wrongHash = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          `A PATCH path=src/patchTarget.ts span=${start}:${end} hash=deadbeef`,
          "<<CODE",
          "2",
          "CODE",
        ].join("\n"),
      });
      expect(wrongHash.exitCode).toBe(1);
      expect(readFileSync(target, "utf8")).toBe(original);

      const applied = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          `A PATCH path=src/patchTarget.ts span=${start}:${end} hash=${hashText("1").slice(0, 12)}`,
          "<<CODE",
          "2",
          "CODE",
        ].join("\n"),
      });
      expect(applied.exitCode).toBe(0);
      expect(applied.observations.some((item) => item.code === "O PATCH.APPLIED")).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("export const value = 2;\n");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions create symbols inside existing code files", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "symbols.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(target, "export const existing = true;\n", "utf8");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A CREATE.SYMBOL path=src/symbols.ts kind=function name=createdSymbol export=true",
          "<<CODE",
          "export function createdSymbol() {",
          "  return existing;",
          "}",
          "CODE",
        ].join("\n"),
      });
      expect(result.exitCode).toBe(0);
      expect(result.observations.some((item) => item.code === "O SYMBOL.CREATED")).toBe(true);
      expect(readFileSync(target, "utf8")).toContain("export function createdSymbol()");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions add imports and exports, including module id addressing", () => {
    const workspace = scaffoldCairWorkspace();
    const commandDir = join(workspace, "src", "commands");
    mkdirSync(commandDir, { recursive: true });
    const commandFile = join(commandDir, "createTicket.ts");
    writeFileSync(commandFile, "export function createTicket() {\n  return true;\n}\n", "utf8");
    const indexFile = join(workspace, "src", "index.ts");
    writeFileSync(indexFile, "export const existing = true;\n", "utf8");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A ADD.IMPORT file=M#1 symbol=Stripe from=stripe",
          "A ADD.EXPORT path=src/index.ts symbol=createTicket from=./commands/createTicket.ts",
        ].join("\n"),
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(commandFile, "utf8")).toContain('import { Stripe } from "stripe";');
      expect(readFileSync(indexFile, "utf8")).toContain('export { createTicket } from "./commands/createTicket.ts";');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("semantic actions rename symbols with explicit expectations", () => {
    const workspace = scaffoldCairWorkspace();
    const commandFile = join(workspace, "src", "commands", "createTicket.ts");
    const current = readFileSync(commandFile, "utf8");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A RENAME.SYMBOL target=S#1 newName=openTicket",
          "expect.file=src/commands/createTicket.ts",
          "expect.kind=command",
          `expect.hash=${hashText(current)}`,
        ].join(" "),
      });
      expect(result.exitCode).toBe(0);
      expect(result.observations.some((item) => item.code === "O RENAME.APPLIED")).toBe(true);
      expect(readFileSync(commandFile, "utf8")).toContain("function openTicket()");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("semantic actions move symbols between files", () => {
    const workspace = scaffoldCairWorkspace();
    const commandFile = join(workspace, "src", "commands", "createTicket.ts");
    const movedFile = join(workspace, "src", "moved.ts");
    const original = readFileSync(commandFile, "utf8");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A MOVE.SYMBOL target=S#1 to=src/moved.ts",
          "expect.file=src/commands/createTicket.ts",
          "expect.kind=command",
          `expect.hash=${hashText(original)}`,
        ].join(" "),
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(commandFile, "utf8")).not.toContain("createTicket");
      expect(readFileSync(movedFile, "utf8")).toContain("function createTicket()");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("semantic actions update signatures, params, callsites, imports, and formatting", () => {
    const workspace = scaffoldCairWorkspace();
    const commandFile = join(workspace, "src", "commands", "createTicket.ts");
    const originalSymbol = "export function createTicket() {\n  return true;\n}\n";
    writeFileSync(
      commandFile,
      `${originalSymbol}\nexport const result = createTicket();\n`,
      "utf8",
    );
    try {
      const update = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          [
            "A UPDATE.SIGNATURE target=S#1 signature=\"export function createTicket(input: string): boolean\"",
            "expect.file=src/commands/createTicket.ts",
            "expect.kind=command",
            `expect.hash=${hashText(originalSymbol)}`,
          ].join(" "),
          [
            "A ADD.PARAM target=S#1 name=tenantId type=string default=\"defaultTenant\"",
            "expect.file=src/commands/createTicket.ts",
            "expect.kind=command",
            `expect.hash=${hashText(originalSymbol)}`,
          ].join(" "),
          [
            "A UPDATE.CALLSITES target=S#1 appendArg=\"defaultTenant\"",
            "expect.file=src/commands/createTicket.ts",
            "expect.kind=command",
            `expect.hash=${hashText(originalSymbol)}`,
          ].join(" "),
        ].join("\n"),
      });
      expect(update.exitCode).toBe(0);
      const updated = readFileSync(commandFile, "utf8");
      expect(updated).toContain("input: string");
      expect(updated).toContain("tenantId: string");
      expect(updated).toContain("createTicket(defaultTenant)");

      writeFileSync(commandFile, "import { z } from \"zod\";\nimport { a } from \"./a\";\nexport  const   x=1\n", "utf8");
      const organized = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A ORGANIZE.IMPORTS file=M#1",
      });
      expect(organized.exitCode).toBe(0);

      const formatted = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A FORMAT file=M#1",
      });
      expect(formatted.exitCode).toBe(0);
      expect(readFileSync(commandFile, "utf8")).toContain("export const x = 1");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("pattern actions find and rewrite structural-looking code compactly", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "pattern.ts");
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(target, "console.log(\"hello\");\n", "utf8");
    try {
      const found = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A FIND.PATTERN scope=src pattern=\"console.log($$$A)\"",
        dryRun: true,
      });
      expect(found.exitCode).toBe(0);
      expect(found.observations[0]?.text).toContain("matches=1");

      const rewritten = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A REWRITE.PATTERN scope=src pattern=\"console.log($$$A)\" replacement=\"logger.info($$$A)\"",
      });
      expect(rewritten.exitCode).toBe(0);
      expect(readFileSync(target, "utf8")).toContain("logger.info(\"hello\")");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("verify impact surfaces tests for a symbol", () => {
    const workspace = scaffoldCairWorkspace();
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "V IMPACT target=S#1",
        dryRun: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.observations[0]?.text).toContain("tests=T#1");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("Forge-native make actions return plans through CAIR", () => {
    const workspace = scaffoldCairWorkspace();
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A MAKE.TABLE name=tickets fields=title:text",
        plan: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.observations[0]?.code).toBe("O MAKE.PLAN");

      const compact = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: "A MT n=notes fields=body:text",
        plan: true,
      });
      expect(compact.exitCode).toBe(0);
      expect(compact.observations[0]?.code).toBe("O MAKE.PLAN");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("Forge-native support actions add tests and wire exports", () => {
    const workspace = scaffoldCairWorkspace();
    const testFile = join(workspace, "tests", "command", "create-ticket.test.ts");
    const indexFile = join(workspace, "src", "index.ts");
    try {
      const result = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A AT t=S#1 kind=unit path=tests/command/create-ticket.test.ts",
          "A WX t=S#1 file=src/index.ts",
        ].join("\n"),
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(testFile, "utf8")).toContain("expect(createTicket).toBeDefined()");
      expect(readFileSync(indexFile, "utf8")).toContain('export { createTicket } from "./commands/createTicket";');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("actions refuse generated files unless explicitly allowed", () => {
    const workspace = scaffoldCairWorkspace();
    const target = join(workspace, "src", "forge", "_generated", "blocked.ts");
    try {
      const blocked = runCairCommand({
        subcommand: "action",
        workspaceRoot: workspace,
        json: false,
        format: "text",
        action: [
          "A CREATE.FILE path=src/forge/_generated/blocked.ts",
          "<<CODE",
          "export const blocked = true;",
          "CODE",
        ].join("\n"),
      });
      expect(blocked.exitCode).toBe(1);
      expect(existsSync(target)).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
