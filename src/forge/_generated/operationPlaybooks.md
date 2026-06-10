// @forge-generated generator=0.0.0 input=eb8969e9c73c889933f582f8b790851a06d3bd49089208206f420481bbd031a9 content=d09acc77af9a4b4ed0a025f110096eef47086945b89e0578c1eec004f27cb4d6
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

## Add a table

1. Edit src/forge/schema.ts.
2. Include tenantId for tenant-scoped data.
3. Run forge generate.
4. Run forge db diff.
5. Run forge verify --strict.

## Add a package

1. Use forge add <alias>.
2. Do not install packages manually unless the architecture exception is intentional.
3. Run forge generate.
4. Run forge check.

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
