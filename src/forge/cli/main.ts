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
    "  forge changed --authored --json  Show only authored changed files, excluding generated artifacts",
    "  forge changed --review --json  Show review-focused app/config/docs changes, excluding local agent/browser artifacts",
    "  forge changed --commit-ready --json  Show files suitable for git add, excluding generated and operational artifacts",
    "  forge new my-app --template minimal-web --field-test  Create an installed WorkOS/auth.md field-test app",
    "  forge field-test create vendor-access --auth workos --template minimal-web --json  Create a real field-test app",
    "  forge field-test run --templates minimal-web,nuxt-web --package-managers npm,pnpm --runtime-probes --auth-probes --json",
    "  forge field-test report --json  Summarize the machine-readable field-test report",
    "  forge diff authored       Run the authored-only git diff pathspec",
    "  forge handoff --json      Compact work handoff for the next external code agent",
    "  forge agent onboard --target codex --json  Prepare adapter, hooks, memory, and dev snapshot",
    "  forge doctor agent --target codex --json  Check adapter, hooks, and Agent Memory readiness",
    "  forge doctor delta --json  Check DeltaDB writability, queue drain, redaction, and gitignore posture",
    "  forge doctor runtime --json  Check generated freshness, local dev lifecycle, and PGlite posture",
    "  forge agent ingest codex --watch --file .forge/agent/events.ndjson --json",
    "  forge docs check --json  Check public docs, ReadTheDocs config, links, and local MkDocs tooling",
    "  forge docs check --build --install-venv --json  Build docs strictly in a local RTD-style venv",
    "  forge release doctor --json  Check npm publish readiness plus separate production deploy readiness",
    "  forge authmd generate       Write public/auth.md from the generated agent/auth contract",
    "  forge auth check --production --json  Fail unless auth is jwt/oidc production-ready",
    "  forge authmd check --json   Check public/auth.md drift for CI and agent-ready apps",
    "  forge workos install --yes --json  Delegate AuthKit setup to npx --yes workos@latest install",
    "  forge workos doctor --json  Check WorkOS AuthKit/FGA files, claims, seed, webhook, and tenant guards",
    "  forge workos doctor --yes --json  Run local checks, then delegate to npx --yes workos@latest doctor",
    "  forge workos seed --file workos-seed.yml --dry-run --json  Validate WorkOS seed without hosted changes",
    "  forge deploy plan --target docker --json  Explain production deploy gates and commands",
    "  forge deploy check --production --json  Gate auth, DB, metadata, generated artifacts, and liveQuery readiness",
    "  forge deploy render docker  Write Docker production deploy files under deploy/",
    "  forge deploy verify --production --url https://app.example.com --json  Probe /health and validate public auth metadata",
    "  forge release check --allow-missing-local-release --json  Gate release readiness without failing on unprepared local artifacts",
    "  forge self-host check --prepared-only --json  Report compose readiness without creating deploy files",
    "  forge delta status --verbose --json  Include Delta schema, lock, and aggregate count details",
    "  forge delta compact --json  Compact redacted local agent queue history",
    "  forge delta prune --older-than 30d --dry-run --json  Plan local Delta operational retention",
    "  forge delta export --redacted --json  Export redacted Delta status, timeline, and agent memory",
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
    "  forge verify              App-level default verification for the current project",
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

function formatDevHelp(): string {
  return [
    "ForgeOS dev",
    "",
    "Usage:",
    "  forge dev [status|stop] [options]",
    "",
    "Options:",
    "  --db memory|pglite|postgres|none  Choose the development database adapter",
    "  --port <port>                     API runtime port; use 0 for an ephemeral port",
    "  --web-port <port>                 Web dev server port",
    "  --host <host>                     Bind host, default 127.0.0.1",
    "  --no-web                          Start API/runtime only",
    "  --api-only                        Start API/runtime only",
    "  --web-only                        Start web server only, expecting an API runtime",
    "  --no-worker                       Disable local worker",
    "  --no-watch                        Disable file watching",
    "  --once --json                     Run one-shot diagnostics without starting servers",
    "  --detach --json                   Start dev in the background with .forge/dev/dev.pid and .forge/dev/dev.log",
    "",
    "Examples:",
    "  forge dev --db memory --port 3777 --web-port 5174",
    "  forge dev --db pglite --once --json",
    "  forge dev --detach --db memory --port 0 --json",
    "  forge dev status --json",
    "  forge dev stop --json",
    "",
  ].join("\n");
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv[0] === "dev" && (argv.includes("--help") || argv.includes("-h"))) {
    process.stdout.write(formatDevHelp());
    return 0;
  }

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
