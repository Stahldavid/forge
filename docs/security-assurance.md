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
forge security prove --db postgres --json
forge verify --strict --script-timeout-ms 120000
bun test tests/security
```

The current implementation covers adversarial fixtures for runtime boundaries, runtime tenant isolation, JWT/OIDC negative auth paths, secret redaction, agent tool metadata, structural agent redteam checks, standards crosswalks, release evidence, and Postgres RLS tenant isolation.

`forge security prove --json` reports an `assurance` level:

- `structural-only`: local checks passed, but the RLS proof did not run against Postgres.
- `postgres-proved`: the proof included the Postgres RLS adversarial probes.

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
node ./bin/forge.mjs rls test --db postgres --json
node ./bin/forge.mjs security prove --db postgres --json
node ./bin/forge-bun.mjs test tests/security --timeout 120000
```

Run the broader gate before release:

```bash
node ./bin/forge.mjs verify --strict --script-timeout-ms 120000
npm run field:test -- --package-managers npm --templates minimal-web --forge-spec "npm:forgeos@alpha" --install --runtime-probes --json
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
security-proof.json
runtime-boundaries.json
secret-redaction.json
agent-tools.json
agent-redteam.json
```

Evidence files must not include:

- secret values;
- `.env` contents;
- database row data from real users;
- raw prompts when retention is disabled;
- large telemetry payloads.

## Current Gaps

The current assurance layer is intentionally not the final security story. The next layers are:

1. Deeper prompt-injection and indirect prompt-injection redteam tests with controlled model/tool loops.
2. More runtime tenant isolation scenarios for generated agent auto-tools and HTTP probes.
3. Webhook signature, replay, and tamper tests.
4. SBOM and dependency vulnerability evidence attached to each release.
5. External review of auth claim mapping, telemetry sinks, and RLS policy generation.

## Related Pages

- [Security and Data](security-and-data.md)
- [Threat Model](threat-model.md)
- [Security Standards Crosswalk](security-standards.md)
- [Production Readiness](production-readiness.md)
- [AI Agents](ai-agents.md)
- [Field Testing](field-testing.md)
