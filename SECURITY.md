# Security Policy

ForgeOS is currently an alpha project. Security reports are welcome.

## Supported Versions

| Version | Supported |
|---------|-----------|
| `0.1.x-alpha` | Security fixes accepted on `main` |

## Reporting A Vulnerability

Until a dedicated private disclosure channel is published, avoid posting exploit details, secret leakage, tenant bypasses, or supply-chain vulnerabilities in public issues.

Send a minimal report to the repository maintainer with:

- affected version or commit;
- reproduction steps;
- expected impact;
- whether secrets, tenant data, or production credentials are involved;
- any suggested fix or mitigation.

## Scope

In scope:

- compiler guardrails;
- runtime boundary enforcement;
- auth/JWT/OIDC handling;
- policies and tenant isolation;
- generated Postgres RLS;
- secrets and telemetry redaction;
- AI tools and agent approval boundaries;
- generated artifacts and agent contracts;
- npm/GitHub release process.

Out of scope for public issues:

- disclosure of real secrets;
- production tenant data;
- destructive testing against infrastructure not owned by the reporter;
- social engineering.

## Assurance Artifacts

Security invariants live in `security/SECURITY_INVARIANTS.md`. CI evidence is expected to be produced by `security-assurance` and release/field-test workflows.
