// @forge-generated generator=0.1.0-alpha.0 input=91d8894f322b8dd604714d7b26a8bac3b5bbb0904d62cc0e2761ba21098e1537 content=462309a5bbe9b5c87581faf1755900bdfac7a1b938a89a5dc90472dff9de4340
# Operation Playbooks

## Choose the right workflow

1. Run forge do "<objective>" --json when the next command is not obvious.
2. Use forge do fix --json for failures, forge do verify --json before handoff, and forge do connect-ui --json for frontend wiring.
3. Follow the returned plan, filesToInspect, risks, and nextAction before using lower-level commands directly.

## Add a command

1. Add a file under src/commands.
2. Declare auth with can("policy.name") unless intentionally public/system.
3. Use ctx.db for transactional writes.
4. Use ctx.emit for side effects.
5. Run forge generate.
6. Run forge verify --strict.

## Add a query

1. Add a file under src/queries.
2. Keep it read-only.
3. Declare auth explicitly.
4. Run forge generate.
5. Run forge check.

## Add a liveQuery

1. Add a liveQuery under src/queries.
2. Keep it read-only and tenant-scoped when reading tenant tables.
3. Run forge generate.
4. Use forge inspect client --json to confirm client exposure.

## Debug a stale liveQuery

1. Run forge live status --json.
2. Run forge live invalidations list --json and confirm the table and tenant changed.
3. Run forge live debug <subscriptionId> --json when a subscription id is available.
4. Check that _forge_live_invalidations has revisions newer than the last sent snapshot.
5. Reconnect with Last-Event-ID or ?lastRevision=<revision> to verify resume behavior.

## Add a table

1. Edit src/forge/schema.ts.
2. Include tenantId for tenant-scoped data.
3. Run forge generate.
4. Run forge db diff.
5. Run forge verify --strict.

## Scaffold a resource

1. Run forge make resource <name> --fields name:type,status:enum(open,closed) --dry-run --json.
2. Review the plan and diagnostics.
3. Run forge make resource <name> --fields name:type --with-ui --yes when the resource should be visible in the web app.
4. Run forge generate.
5. Run forge verify --strict.

## Apply a feature blueprint

1. Write a JSON blueprint under .forge/blueprints.
2. Run forge feature validate <blueprint> --json.
3. Run forge feature plan <blueprint>.
4. Review the plan, impact, and risk.
5. Run forge feature apply <blueprint> --yes.
6. Run forge verify --strict.

## Safely refactor a feature

1. Run forge refactor rename field <table.field> <table.field> --dry-run --json.
2. Rename codemods are AST-aware for extract-action, rename field, and rename table.
3. Field renames are scoped to the target table, so tickets.priority only rewrites references linked to tickets.
4. Review filesToModify, migrationPlan, diagnostics, and risk.
5. Use --allow-high-risk only for intentional high-risk refactors.
6. Apply with forge refactor rename field <table.field> <table.field> --yes.
7. Run forge generate.
8. Run forge verify --strict.

## Plan impact-based tests

1. Run forge impact --changed --json.
2. Run forge test plan --changed --json.
3. Run forge test run --changed --timeout-ms 120000 --json for targeted checks.
4. Use forge verify --changed for the fast impact gate.
5. Run forge verify --strict before final handoff.

## Repair a failing check

1. Run forge test run --changed --json.
2. Run forge repair diagnose --from-last-test-run --json.
3. Review the failureKind, likelyCause, suggestedRepairs, and confidence.
4. Apply only high-confidence repairs automatically.
5. Run forge verify --changed.
6. Run forge verify --strict before final handoff.

## Add a package

1. Use forge add <alias>.
2. Do not install packages manually unless the architecture exception is intentional.
3. Run forge generate.
4. Run forge check.

## Upgrade a package

1. Run forge deps upgrade-plan <package> --to latest.
2. Use forge deps inspect <package> --json and forge deps api <package> <symbol> --json before relying on changed external APIs.
3. Use forge deps trace <package> --json when exports or type resolution are ambiguous.
4. Read .forge/upgrades/.../plan.md.
5. If risk is high, inspect affected files and generated adapters before applying.
6. Apply with forge deps upgrade-apply <plan>.
7. Finish with forge verify --strict.

## Debug a policy error

1. Capture the traceId from the response or frontend.
2. Run forge telemetry inspect <traceId>.
3. Run forge policy simulate <policy> --role <role>.

## Run dev

1. Run forge dev for the full local loop: generated checks, API runtime, web app, DB, worker, watch, and startup URLs.
2. Run forge dev --once --json for a one-shot diagnostic cycle.
3. Use --api-only, --web-only, --no-watch, or --no-worker only when narrowing the loop intentionally.
4. When a web app exists, forge dev starts the API runtime and the web dev server together and prints both URLs.
5. Use generated client and React hooks through web/lib/forge.ts.

## Add or update frontend

1. Run forge make ui --framework vite --dry-run --json when the app does not have a web root.
2. Use web/lib/forge.ts as the generated client bridge.
3. Mount ForgeProvider once in the web app provider/layout layer; use devAuth for local development.
4. Use useQuery, useCommand, and useLiveQuery instead of raw /commands or /queries fetches.
5. Run forge generate so frontendGraph and agentContract include routes and bindings.
6. Run forge inspect capabilities --json to confirm UI actions map to runtime capabilities.
7. Run forge dev --once --json and forge doctor --json.

## Self-host

1. Run forge self-host compose.
2. Review deploy/.env.example.
3. Run forge self-host check.

## Debug a production stack trace

1. Run forge release inspect <releaseId> --json.
2. Run forge release sourcemaps symbolicate --input stacktrace.json --json.
3. Open the original source file and line from the symbolicated frame.
4. Use forge telemetry inspect <traceId> --with-release --json when a trace id is available.
