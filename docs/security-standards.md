# Security Standards Crosswalk

ForgeOS does not claim a formal certification. This page maps the current security controls to common public standards so maintainers, adopters, and AI coding agents can see what is covered, what is partial, and what still needs external validation.

The source crosswalk lives in:

```txt
security/STANDARDS_CROSSWALK.md
```

## How to Generate Evidence

Use the security proof command:

```bash
forge security prove --json
```

For DB-enforced tenant isolation, run against Postgres:

```bash
forge rls test --db postgres --json
forge rls mutate-test --json
forge security prove --db postgres --json
```

The security assurance workflow uploads evidence from:

```txt
security/evidence/latest/
```

## Covered Areas

| Area | Status | Main evidence |
| --- | --- | --- |
| Runtime boundaries | Covered | `forge check --json`, `tests/security/runtime-boundaries.test.ts` |
| Runtime tenant isolation | Covered | `tests/security/tenant-isolation/runtime-api.test.ts`, `tests/security/tenant-isolation/http-runtime.test.ts`, `forge security prove --json` |
| Secret redaction | Covered | `forge secrets prove --json`, `tests/security/secret-redaction.test.ts` |
| Webhook authenticity helpers | Partial | `tests/security/webhooks/webhook-security.test.ts`, `src/forge/runtime/webhooks/security.ts` |
| Agent tool approval metadata | Partial | `forge ai tools --json`, `forge ai redteam --json`, `tests/security/agent-tools.test.ts` |
| Postgres tenant isolation | Covered when run with Postgres | `forge rls test --db postgres --json`, `forge rls mutate-test --json` |
| JWT/OIDC production auth | Partial | `forge auth prove --json`, `tests/security/auth-negative.test.ts` |
| Supply-chain provenance | Covered for npm publish path | `.github/workflows/publish.yml`, Trusted Publisher, `NPM_CONFIG_PROVENANCE=true` |
| SBOM | Partial | basic CycloneDX SBOM from `npm run release:evidence` |

## Standards Mapped

The crosswalk currently maps ForgeOS controls to:

- OWASP ASVS-oriented application controls;
- OWASP API Top 10-oriented API controls;
- OWASP LLM Top 10-oriented AI-agent controls;
- NIST SSDF-oriented secure development practices;
- SLSA/npm provenance-oriented supply-chain controls.

## Release Gate

The npm publish workflow runs:

```bash
npm run forge -- security prove --json
```

before packaging and publishing. The publish workflow now runs the stronger Postgres-backed security proof, RLS mutation proof, release evidence, and SBOM generation before packaging and publishing.

## What This Does Not Mean

This crosswalk is not:

- a SOC 2 report;
- an ISO 27001 certification;
- an independent penetration test;
- a guarantee that every app built with ForgeOS is secure.

It is a public, versioned map from security claims to evidence. Apps still need their own threat model, secrets policy, auth provider review, dependency review, and production deployment review.

## Related Pages

- [Security Assurance](security-assurance.md)
- [Threat Model](threat-model.md)
- [Production Readiness](production-readiness.md)
- [Release](release.md)
