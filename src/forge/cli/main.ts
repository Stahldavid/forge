#!/usr/bin/env bun
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { isMainModule } from "../platform/module.ts";
import { executeCommand } from "./commands.ts";
import { hasUnknownOption, parseCli } from "./parse.ts";
import { formatJsonResult } from "./output.ts";

function formatHelp(): string {
  return [
    "ForgeOS",
    "",
    "Start with one of these:",
    "  forge dev                 Run API, DB/worker, watch, and web app when present",
    "  forge dev --once --json   One-shot health/diagnostic loop for agents and CI",
    "  forge do \"fix\" --json     Ask ForgeOS for the right workflow and commands",
    "  forge inspect all --json  Read the generated machine contract",
    "",
    "Useful next commands:",
    "  forge generate",
    "  forge check --json",
    "  forge verify --strict",
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

  return executeCommand(parsed.command);
}

if (isMainModule(import.meta)) {
  const exitCode = await main();
  process.exit(exitCode);
}
