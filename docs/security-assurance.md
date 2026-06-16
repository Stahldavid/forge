# Security Assurance

ForgeOS security is not only a set of rules. It is a set of invariants, tests, CI gates, and evidence artifacts that should prove the rules continue to hold.

## What This Covers

The public invariants live in:

```txt
security/SECURITY_INVARIANTS.md
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
forge rls check --json
forge verify --strict --script-timeout-ms 120000
bun test tests/security
```

The first implementation focuses on adversarial fixtures for runtime boundaries, secret redaction, and agent tool safety. Later layers add Postgres RLS adversarial tests, auth negative tests, standards crosswalks, and release supply-chain evidence.

## Local Security Gate

Run the focused gate locally:

```bash
node ./bin/forge.mjs generate --check
node ./bin/forge.mjs check --json
node ./bin/forge.mjs auth check --json
node ./bin/forge.mjs secrets check --json
node ./bin/forge.mjs rls check --json
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
rls-check.json
runtime-boundaries.json
secret-redaction.json
agent-tools.json
```

Evidence files must not include:

- secret values;
- `.env` contents;
- database row data from real users;
- raw prompts when retention is disabled;
- large telemetry payloads.

## Current Gaps

The current assurance layer is intentionally not the final security story. The next layers are:

1. Postgres RLS adversarial tests with a real Postgres service and non-owner role.
2. JWT/OIDC negative auth tests.
3. Agent redteam tests for prompt injection, excessive agency, approval bypass, tenant leakage, and secret extraction.
4. Standards crosswalks for OWASP ASVS, OWASP API Top 10, OWASP LLM Top 10, NIST SSDF, and SLSA.
5. Release security gate with SBOM/provenance/dependency evidence.

## Related Pages

- [Security and Data](security-and-data.md)
- [Threat Model](threat-model.md)
- [Production Readiness](production-readiness.md)
- [AI Agents](ai-agents.md)
- [Field Testing](field-testing.md)
