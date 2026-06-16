# ForgeOS Security Standards Crosswalk

This crosswalk maps ForgeOS security controls to public standards and evidence. It is an assurance aid, not a certification claim.

Status values:

| Status | Meaning |
| --- | --- |
| Covered | Automated checks and public evidence exist. |
| Partial | Design and some checks exist; more adversarial or external validation is needed. |
| Planned | The control is recognized but not yet automated. |

## OWASP ASVS-Oriented Controls

| Area | ForgeOS control | Status | Evidence |
| --- | --- | --- | --- |
| Authentication | JWT/OIDC config, issuer/audience checks, negative token tests, generated auth contract | Partial | `forge auth prove --json`, `tests/security/auth-negative.test.ts`, `src/forge/_generated/authConfig.json` |
| Session context | Tenant/user/role mapped into runtime and DB session context | Covered | `src/forge/runtime/db/session-context.ts`, `forge rls test --db postgres --json` |
| Access control | Policies declared on commands/queries and checked before runtime execution | Covered | `forge policy check --strict-policies`, `forge check --json` |
| Tenant isolation | Runtime tenant scope plus Postgres RLS with FORCE RLS policies and mutation checks | Covered | `tests/security/tenant-isolation/runtime-api.test.ts`, `tests/security/tenant-isolation/http-runtime.test.ts`, `forge rls test --db postgres --json`, `forge rls mutate-test --json` |
| Secrets | Secret names tracked without values; generated files and telemetry scrubbed by key and known value | Covered | `forge secrets prove --json`, `tests/security/secret-redaction.test.ts` |
| Webhooks | HMAC signature verification, timestamp replay windows, and event replay detection helpers | Partial | `tests/security/webhooks/webhook-security.test.ts`, `src/forge/runtime/webhooks/security.ts` |
| Logging | Trace IDs, release metadata, redaction rules | Partial | `forge telemetry inspect`, `tests/security/secret-redaction.test.ts` |

## OWASP API Top 10-Oriented Controls

| Risk | ForgeOS mitigation | Status | Evidence |
| --- | --- | --- | --- |
| Broken object property authorization | Tenant-scoped generated DB clients, HTTP probes, RLS probes, and RLS mutation checks | Covered | `tests/security/tenant-isolation/runtime-api.test.ts`, `tests/security/tenant-isolation/http-runtime.test.ts`, `forge rls test --db postgres --json`, `forge rls mutate-test --json` |
| Broken authentication | Production auth modes require JWT/OIDC config and reject common negative token paths | Partial | `forge auth prove --json`, `tests/security/auth-negative.test.ts` |
| Broken object level authorization | Policies bound to entries and checked before handlers | Covered | `forge policy check --strict-policies` |
| Unrestricted resource consumption | Agent step limits and liveQuery hardening | Partial | `forge ai check --json`, `forge live status --json` |
| Security misconfiguration | `forge doctor`, generated runtime rules, release/security proof gates | Partial | `forge security prove --json`, `forge doctor` |
| Unsafe API consumption | `forge add`, package runtime guards, dependency API inspection, webhook authenticity helpers | Partial | `forge deps api`, `forge deps runtime-compat`, `tests/security/webhooks/webhook-security.test.ts` |

## OWASP LLM Top 10-Oriented Controls

| Risk | ForgeOS mitigation | Status | Evidence |
| --- | --- | --- | --- |
| Prompt injection | AI allowed only in actions/workflows/endpoints/server; tools carry risk metadata and structural redteam checks | Partial | `forge ai tools --json`, `forge ai redteam --json`, `tests/security/agent-tools.test.ts` |
| Sensitive information disclosure | Secret access through `ctx.secrets`; scrubbed telemetry and generated artifacts | Covered | `forge secrets prove --json`, `tests/security/secret-redaction.test.ts` |
| Excessive agency | Tool risk, approval metadata, stop conditions | Partial | `forge ai redteam --json`, `tests/security/agent-tools.test.ts` |
| Insecure plugin design | Integration recipes declare allowed/denied contexts and package guards | Partial | `forge add <alias>`, `forge inspect capabilities --json` |
| Supply-chain vulnerabilities | Dependency inspection, runtime compatibility, provenance publishing | Partial | `forge deps inspect`, `publish.yml`, `NPM_CONFIG_PROVENANCE=true` |

## NIST SSDF-Oriented Controls

| Practice | ForgeOS evidence | Status |
| --- | --- | --- |
| Define security requirements | `security/SECURITY_INVARIANTS.md`, `docs/threat-model.md` | Covered |
| Protect software from tampering | Trusted Publisher, npm provenance, strict 2FA/token posture | Partial |
| Produce well-secured software | Runtime guards, security tests, CI security proof | Partial |
| Verify third-party components | Package graph, dependency API/risk inspection | Partial |
| Respond to vulnerabilities | `SECURITY.md`, public docs and issue guidance | Partial |

## SLSA / npm Provenance-Oriented Controls

| Control | ForgeOS evidence | Status |
| --- | --- | --- |
| Source is version controlled | GitHub public repository | Covered |
| Build runs in CI | `.github/workflows/publish.yml` | Covered |
| OIDC trusted publishing | npm Trusted Publisher + `id-token: write` | Covered |
| Provenance requested | `NPM_CONFIG_PROVENANCE=true` | Covered |
| Pre-publish security gate | `npm run forge -- security prove --db postgres --json` in publish workflow | Covered |
| SBOM | Basic CycloneDX SBOM emitted by `npm run release:evidence` | Partial |
| External security audit | Not completed yet | Planned |

## Minimum Release Evidence

A release should not be promoted beyond alpha unless the release notes can point to:

```txt
security/evidence/latest/security-proof.json
security/evidence/latest/rls-test.json
security/evidence/latest/rls-mutation.json
security/evidence/latest/release-supply-chain.json
security/evidence/latest/sbom.cyclonedx.json
field-reports/*.json
npm provenance / trusted publisher run
```

No evidence artifact may contain secret values, `.env` contents, database row data, raw prompts, or large telemetry payloads.
