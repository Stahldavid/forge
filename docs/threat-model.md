# Threat Model

ForgeOS is an agent-native application framework. Its security model must protect both normal app users and AI coding/runtime agents that inspect, edit, or operate the app.

This threat model is public so users can understand the intended boundaries, current mitigations, and areas that still need more validation before critical production use.

## Scope

This document covers ForgeOS framework-level risks:

- generated app contracts;
- command/query/liveQuery/action/workflow runtime boundaries;
- auth, policies, tenant scope, and RLS;
- secrets and environment access;
- package and import guards;
- frontend capability map;
- AI tools and agents;
- diagnostics, traces, telemetry, repair, review, and generated files.

It does not replace an application-specific threat model. Every production app still needs its own review of business logic, data sensitivity, providers, deployments, and user roles.

## Security goals

ForgeOS aims to:

- keep tenant data isolated;
- ensure policies guard runtime entries consistently;
- keep commands transactional and deterministic;
- move side effects to actions/workflows after commit;
- keep secrets out of generated files, frontend code, logs, and traces;
- stop forbidden package/runtime combinations before handoff;
- make frontend/backend wiring inspectable;
- make AI tools explicit, typed, risk-classified, and approval-aware;
- give agents safe inspect/check/verify commands instead of relying on guessing.

## Assets

| Asset | Why it matters |
|-------|----------------|
| Tenant data | Cross-tenant reads or writes are the most serious app-level failure |
| Policies and roles | Authorization bugs can expose or mutate protected data |
| JWT/OIDC claims | Incorrect claim mapping can impersonate users or tenants |
| Secrets | Provider/API keys must never leak to generated files, frontend bundles, logs, or traces |
| Generated contracts | Agents use these files to decide what to edit and verify |
| Runtime entries | Commands, queries, liveQueries, actions, workflows, endpoints |
| Outbox/workflows | Side effects must happen after commit and be auditable |
| Package graph/import guards | Packages must only run in allowed contexts |
| AI tools and traces | Tool calls can read/write data and may expose sensitive context |
| Frontend capability map | UI-to-runtime drift can bypass intended flows or hide broken features |

## Trust boundaries

```txt
browser/client
  -> Forge HTTP runtime
  -> auth/policy/tenant context
  -> command/query/liveQuery/action/workflow
  -> database
  -> outbox/workflow workers
  -> external providers
```

Important boundaries:

| Boundary | Main risk | ForgeOS mitigation |
|----------|-----------|--------------------|
| Browser to API | spoofed identity, missing auth, raw runtime calls | auth modes, generated clients, policy checks, trace IDs |
| API to command/query/liveQuery | forbidden side effects, cross-tenant access | runtime rules, policy registry, tenant scope, guard checks |
| Command to outbox | side effects before commit | `ctx.emit`, transactional command model |
| Worker to provider | secret leakage, retries, duplicate effects | actions/workflows, `ctx.secrets`, telemetry, idempotency guidance |
| Source to generated contract | stale or misleading generated files | `forge generate --check`, deterministic outputs, drift checks |
| Package to runtime context | network SDK inside command/query/liveQuery | PackageGraph, runtime matrix, import guards |
| Agent to app tools | unsafe writes, prompt injection, data exfiltration | typed tools, risk/approval metadata, tenant/auth context, traces |

## Threats and mitigations

### Cross-tenant data access

Threat:

- A command, query, liveQuery, AI tool, or workflow reads/writes data for another tenant.

Mitigations:

- tenant-scoped table metadata;
- policy registry and permission matrix;
- app runtime tenant context;
- Postgres RLS compiler/checks;
- generated contract exposes table and tenant scope;
- `forge policy simulate` and `forge rls check`.

Validation:

```bash
forge inspect data --json
forge inspect policies --json
forge policy simulate tickets.read --role member --json
forge rls check --json
```

Current limit:

- production apps should test at least two real tenants against both app-level checks and Postgres RLS.

### Policy bypass

Threat:

- A runtime entry is callable without the intended policy, or a frontend path assumes authorization that the backend does not enforce.

Mitigations:

- runtime entries declare `auth: can("...")`;
- `forge check --json` reports policy wiring diagnostics;
- frontend capability map shows UI-to-runtime bindings;
- policy denied responses include trace IDs.

Validation:

```bash
forge check --json
forge inspect capabilities --json
forge policy simulate billing.manage --role member --json
```

### Dev auth in production

Threat:

- `dev-headers` auth is accidentally used for public production traffic.

Mitigations:

- explicit auth modes: `dev-headers`, `jwt`, `oidc`, `disabled`;
- production auth checks;
- generated agent contract exposes auth mode and bearer header.

Validation:

```bash
forge auth check --json
forge inspect all --json
```

Production expectation:

- use `jwt` or `oidc`;
- verify issuer, audience, algorithms, JWKS URI, tenant claim, and role mapping.

### Secret leakage

Threat:

- secret values appear in generated artifacts, frontend bundles, logs, telemetry, traces, or AI prompts.

Mitigations:

- secret registry stores names, not values;
- runtime access through `ctx.secrets`;
- `process.env` checks;
- redaction/scrubbing in telemetry paths;
- generated contract must not include secret values.

Validation:

```bash
forge secrets check --json
forge env check --json
forge check --json
```

Manual review:

- inspect generated files for secret values before deploy;
- avoid passing secrets to AI prompts or tools.

### Forbidden runtime imports

Threat:

- a command/query/liveQuery imports network, filesystem, provider, AI, or secret-capable packages.

Mitigations:

- PackageGraph;
- runtime matrix;
- import guards;
- `forge add` recipes;
- `forge deps runtime-compat`.

Validation:

```bash
forge inspect runtime-matrix --json
forge deps runtime-compat stripe --json
forge check --json
```

### Generated contract drift

Threat:

- an agent reads stale generated files and makes the wrong edit.

Mitigations:

- deterministic generated artifacts;
- `forge generate --check`;
- `forge dev --once --json`;
- generated-file warnings in `AGENTS.md`;
- source-only template hygiene.

Validation:

```bash
forge generate --check
forge dev --once --json
forge agent-contract check
```

### Raw frontend runtime calls

Threat:

- frontend code bypasses generated hooks and calls runtime endpoints directly in ways the capability map cannot understand.

Mitigations:

- generated React hooks;
- `web/lib/forge.ts` bridge pattern;
- frontend graph;
- capability map;
- raw runtime fetch diagnostics.

Validation:

```bash
forge inspect frontend --json
forge inspect capabilities --json
forge do connect-ui --json
```

### AI tool abuse

Threat:

- a model invokes a write/destructive/external tool incorrectly, repeatedly, or under prompt injection.

Mitigations:

- `aiTool` schemas;
- `risk` and `needsApproval`;
- command auto-tools default to approval-required writes;
- max step/tool-call limits;
- Forge auth, tenant scope, policies, and telemetry still apply;
- `forge ai trace`.

Validation:

```bash
forge inspect agent-tools --json
forge ai tools --json
forge ai agents --json
forge ai redteam --json
forge ai redteam --model-level --json
forge ai trace <traceId> --json
```

Current limit:

- `forge ai redteam --model-level` covers deterministic model-level probes for prompt injection, data exfiltration, approval bypass, indirect prompt injection, and cross-tenant requests. Production-facing AI agents should still run app-specific live-model and domain-specific adversarial cases before critical use.

### Telemetry and trace exposure

Threat:

- traces/logs expose PII, prompt contents, provider outputs, tokens, or database rows.

Mitigations:

- telemetry scrubber;
- prompt/output retention disabled by default in documented paths;
- trace IDs for debugging without exposing raw payloads;
- secret leak diagnostics.

Validation:

```bash
forge ai trace <traceId> --json
forge check --json
```

Manual review:

- inspect configured sinks such as Sentry, PostHog, JSONL, or custom telemetry before production use.

### Package API confusion

Threat:

- an agent calls an SDK API incorrectly from stale memory, or imports the right SDK into the wrong context.

Mitigations:

- `forge add` recipes;
- dependency API oracle;
- package resolution traces;
- runtime compatibility hints;
- TypeScript checks.

Validation:

```bash
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
forge check --json
```

## Minimum security review before production

Run:

```bash
forge generate --check
forge check --json
forge auth check --json
forge auth prove --json
forge policy check --strict-policies --json
forge secrets check --json
forge secrets prove --json
forge rls check --json
forge security prove --db postgres --full --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge ai redteam --json
forge ai redteam --model-level --json
forge verify --strict
```

Review:

- auth mode and claim mapping;
- tenant-scoped tables and generated RLS SQL;
- policies on every runtime entry;
- command/query/liveQuery forbidden imports;
- frontend raw runtime fetch warnings;
- AI tool risks and approvals;
- telemetry sinks and redaction;
- secret values in generated artifacts or bundles;
- outbox/workflow idempotency.

## Known gaps

ForgeOS is alpha. Known security hardening gaps include:

- no independent external audit yet;
- more provider-specific live-model adversarial agent-tool reports needed;
- more production Postgres/RLS field reports needed;
- more browser/UI security scenarios needed;
- more package ecosystem fixtures needed;
- more production telemetry sink review needed.

## Reporting security issues

Until a formal security policy is published, do not disclose suspected vulnerabilities in public issues if they include exploit details, secret leakage, or tenant bypass steps.

Open a minimal private contact path with the maintainer first, or file a public issue that says a security report is available without including exploit details.

## Related pages

- [Production Readiness](production-readiness.md)
- [Security and Data](security-and-data.md)
- [AI Agents](ai-agents.md)
- [Package Intelligence](package-intelligence.md)
- [Operations](operations.md)
