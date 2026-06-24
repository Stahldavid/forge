# Security Assurance

ForgeOS security is not only a set of rules. It is a set of invariants, tests, CI gates, and evidence artifacts that should prove the rules continue to hold.

## What This Covers

The public invariants live in:

```txt
security/SECURITY_INVARIANTS.md
```

The public standards mapping lives in:

```txt
security/STANDARDS_CROSSWALK.md
```

They cover:

- production auth must not accept dev headers;
- tenant data must not cross tenant boundaries;
- Postgres RLS must block handler bugs;
- commands must stay deterministic and side-effect free except for `ctx.emit`;
- queries and liveQueries must be read-only;
- agent tools must inherit Forge auth, tenant, policy, telemetry, and approval boundaries;
- secret values must not appear in generated artifacts, telemetry, logs, or reports;
- webhooks must reject invalid signatures, stale timestamps, tampered bodies, and replayed event ids;
- releases must be traceable to CI and package evidence.

## Security Assurance Workflow

The CI workflow is:

```txt
.github/workflows/security-assurance.yml
```

It runs:

```bash
forge generate --check
forge check --json
forge auth check --json
forge secrets check --json
forge auth prove --json
forge secrets prove --json
forge rls test --db postgres --json
forge rls mutate-test --json
forge security prove --db postgres --full --json
npm run security:evidence -- security/evidence/latest/security-proof.json security/evidence/latest
npm run release:evidence -- security/evidence/latest
npm run security:deps -- security/evidence/latest/dependency-audit.json
forge verify --strict --script-timeout-ms 120000
bun test tests/security
```

The current implementation covers adversarial fixtures for runtime boundaries, runtime and HTTP tenant isolation, JWT/OIDC negative auth paths, value-aware secret redaction, webhook signature/replay checks, agent tool metadata, structural agent checks, deterministic model-level agent probes, standards crosswalks, release evidence, SBOM generation, dependency vulnerability evidence, Postgres RLS tenant isolation, and RLS mutation checks.

`forge security prove --json` reports an `assurance` level:

- `structural-only`: local checks passed, but the RLS proof did not run against Postgres.
- `postgres-proved`: the proof included the Postgres RLS adversarial probes.

By default, `forge security prove` aggregates structural proofs and invariant metadata. Pass `--full` or `--run-tests` to execute the invariant security tests inside the proof command and include the resulting test status in `proofs.securityTests`.

## Local Security Gate

Run the focused gate locally:

```bash
node ./bin/forge.mjs generate --check
node ./bin/forge.mjs check --json
node ./bin/forge.mjs auth check --json
node ./bin/forge.mjs secrets check --json
node ./bin/forge.mjs auth prove --json
node ./bin/forge.mjs secrets prove --json
node ./bin/forge.mjs ai redteam --json
node ./bin/forge.mjs ai redteam --model-level --json
node ./bin/forge.mjs rls test --db postgres --json
node ./bin/forge.mjs rls mutate-test --json
node ./bin/forge.mjs security prove --db postgres --full --json
```

Run the broader gate before release:

```bash
node ./bin/forge.mjs verify --strict --script-timeout-ms 120000
npm run field:test -- --package-managers npm --templates minimal-web,nuxt-web --forge-spec "npm:forgeos@alpha" --install --runtime-probes --json
```

## Evidence

Security evidence should be generated into:

```txt
security/evidence/latest/
```

Examples:

```txt
forge-check.json
auth-check.json
secrets-check.json
rls-test.json
rls-mutation.json
security-proof.json
auth-negative.json
tenant-isolation.json
runtime-boundaries.json
secret-redaction.json
agent-tools.json
webhooks.json
release-supply-chain.json
sbom.cyclonedx.json
dependency-audit.json
```

Evidence files must not include:

- secret values;
- `.env` contents;
- database row data from real users;
- raw prompts when retention is disabled;
- large telemetry payloads.

## Current Gaps

The current assurance layer is intentionally not the final security story. The next layers are:

1. More runtime tenant isolation scenarios for generated agent auto-tools and liveQuery HTTP/SSE probes.
2. External review of auth claim mapping, telemetry sinks, webhook recipes, and RLS policy generation.
3. Broader production field reports on real Postgres deployments and longer-lived apps.

## Dependency Vulnerability Evidence

Run:

```bash
npm run security:deps
```

This writes:

```txt
security/evidence/latest/dependency-audit.json
```

The auditor recreates temporary npm installs from the framework package, the create-app wrapper, and both template root/web manifests. Template placeholders are resolved the same way generated apps are resolved, so the evidence reflects a real `npm create forgeos-app@alpha` consumer path instead of raw template files.

The default threshold is `high`. Unwaived high or critical issues fail the command. Waivers are explicit and versioned in:

```txt
security/dependency-audit-waivers.json
```

Keep waivers narrow, include a reason, and set an expiration date.

## Related Pages

- [Security and Data](security-and-data.md)
- [Threat Model](threat-model.md)
- [Security Standards Crosswalk](security-standards.md)
- [Production Readiness](production-readiness.md)
- [AI Agents](ai-agents.md)
- [Field Testing](field-testing.md)
