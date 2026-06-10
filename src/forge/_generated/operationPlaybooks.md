// @forge-generated generator=0.0.0 input=bc5a09656f1c2dc63d25c906f58452be524b2118ee2d2b133e47d389b2ba9f81 content=af4d1b3e01b1355118d9de6dfbdf34fac37a0a8d5a637fba4bfb29bfdfdc2355
# Operation Playbooks

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
3. Run forge make resource <name> --fields name:type --yes.
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
2. Review filesToModify, migrationPlan, diagnostics, and risk.
3. Use --allow-high-risk only for intentional high-risk refactors.
4. Apply with forge refactor rename field <table.field> <table.field> --yes.
5. Run forge generate.
6. Run forge verify --strict.

## Plan impact-based tests

1. Run forge impact --changed --json.
2. Run forge test plan --changed --json.
3. Run forge test run --changed --json for targeted checks.
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
2. Read .forge/upgrades/.../plan.md.
3. If risk is high, inspect affected files and generated adapters before applying.
4. Apply with forge deps upgrade-apply <plan>.
5. Finish with forge verify --strict.

## Debug a policy error

1. Capture the traceId from the response or frontend.
2. Run forge telemetry inspect <traceId>.
3. Run forge policy simulate <policy> --role <role>.

## Run dev

1. Run forge dev --db pglite --worker --telemetry local --mock-ai.
2. Use generated client and React hooks from src/forge/_generated.

## Self-host

1. Run forge self-host compose.
2. Review deploy/.env.example.
3. Run forge self-host check.

## Debug a production stack trace

1. Run forge release inspect <releaseId> --json.
2. Run forge release sourcemaps symbolicate --input stacktrace.json --json.
3. Open the original source file and line from the symbolicated frame.
4. Use forge telemetry inspect <traceId> --with-release --json when a trace id is available.
