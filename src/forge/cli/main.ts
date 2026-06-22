#!/usr/bin/env bun
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { isMainModule } from "../platform/module.ts";
import { executeCommand } from "./commands.ts";
import { hasUnknownOption, parseCli } from "./parse.ts";
import { formatJsonResult } from "./output.ts";
import { recordParsedCliCommand } from "../delta/index.ts";

function formatHelp(): string {
  return [
    "ForgeOS",
    "",
    "Start with one of these:",
    "  forge status --json       Compact project health, handoff state, and next actions",
    "  forge changed --json      Group changed files into human, generated, and risk buckets",
    "  forge handoff --json      Compact work handoff for the next external code agent",
    "  forge agent onboard --target codex --json  Prepare adapter, hooks, memory, and dev snapshot",
    "  forge doctor agent --target codex --json  Check adapter, hooks, and Agent Memory readiness",
    "  forge agent ingest codex --watch --file .forge/agent/events.ndjson --json",
    "  forge studio open <app-path> --preview-port 5174 --target codex --json",
    "  forge studio snapshot <app-path> --preview-port 5174 --target codex --probe-codex-server --json",
    "  forge studio bridge <app-path> --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --probe-codex-server --json",
    "  forge studio doctor <app-path> --preview-port 5174 --target codex --json",
    "  forge studio codex-server <app-path> --probe --json",
    "  forge studio watch <app-path> --preview-port 5174 --target codex --json",
    "  forge dev                 Run API, DB/worker, watch, and web app when present",
    "  forge dev --once --json   One-shot health/diagnostic loop for agents and CI",
    "  forge do \"fix\" --json     Ask ForgeOS for the right workflow and commands",
    "  forge cair snapshot         Compact CAIR project snapshot for agents",
    "  forge cair query \"Q REFS S#1\"  Run a semantic CAIR query",
    "  forge cair action --plan \"A RN t=S#1 nn=renamed\"  Plan a guarded semantic edit",
    "  forge cair action \"A APPLY plan=<P#|path>\"  Apply a guarded CAIR plan",
    "  forge agent print-context --json  Read the generated agent context pack",
    "  forge inspect all --brief --json  Read the smallest aggregate project contract",
    "  forge inspect all --json  Read the compact generated machine contract",
    "  forge mcp serve          Serve ForgeOS Agent Memory tools over MCP stdio",
    "  forge agent context --current --json  Read the Agent Memory context pack",
    "  forge agent timeline --json  Read external-agent hook activity as a compact timeline",
    "  forge doctor windows --json  Diagnose native Windows setup and Bun shims",
    "  forge bench compiler --json  Measure public compiler phase timings",
    "  forge manifest validate ./forge.manifest.json --json  Validate an external runtime manifest",
    "",
    "Useful next commands:",
    "  forge generate",
    "  forge check --json",
    "  forge verify --standard",
    "  forge verify quick        Alias for smoke/fast local checks",
    "  forge verify agent        Alias for standard agent-loop verification",
    "  forge verify release      Alias for strict app release verification",
    "  forge verify framework    Maintainer-only ForgeOS framework test gate",
    "  forge verify --strict --typechecker native --test-jobs 6",
    "  forge verify framework --test-plan --json",
    "",
  ].join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(formatHelp());
    return 0;
  }

  const unknown = hasUnknownOption(argv);
  if (unknown) {
    const diagnostic = createDiagnostic({
      severity: "error",
      code: "FORGE_CLI_USAGE",
      message: `unrecognized option '${unknown}'`,
    });

    if (argv.includes("--json")) {
      process.stdout.write(
        formatJsonResult({
          errors: [diagnostic],
          exitCode: 1,
          failureKind: "usage",
        }),
      );
    } else {
      console.error(`error ${diagnostic.code}: ${diagnostic.message}`);
    }
    return 1;
  }

  const parsed = parseCli(argv);
  if (parsed.errors.length > 0) {
    const errors = parsed.errors.map((message) =>
      createDiagnostic({
        severity: "error",
        code: "FORGE_CLI_USAGE",
        message,
      }),
    );

    if (argv.includes("--json")) {
      process.stdout.write(
        formatJsonResult({
          errors,
          exitCode: 1,
          failureKind: "usage",
        }),
      );
    } else {
      for (const error of errors) {
        console.error(`error ${error.code}: ${error.message}`);
      }
    }
    return 1;
  }

  if (parsed.command === null) {
    return 1;
  }

  const startedAt = Date.now();
  const exitCode = await executeCommand(parsed.command);
  await recordParsedCliCommand({
    command: parsed.command,
    argv,
    exitCode,
    durationMs: Date.now() - startedAt,
  });
  return exitCode;
}

if (isMainModule(import.meta)) {
  const exitCode = await main();
  process.exit(exitCode);
}
