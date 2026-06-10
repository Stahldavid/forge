// @forge-generated generator=0.0.0 input=a7d16d11442ec294033d6f6c5745f3d05275c67221ab40c01ff470ccb2dc627e content=61a349b54f5d0e9cb408bc4e3e53e5125635de68797f1b1a4ab2814213c4b2df
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
