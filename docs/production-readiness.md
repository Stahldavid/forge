# Production Readiness

ForgeOS is currently an alpha framework. It has real runtime, compiler, security, frontend, AI, and verification systems, but not every area has the same production maturity.

Use this matrix to decide what is ready to evaluate, what needs review, and what should not yet be trusted for critical workloads without additional hardening.

## Readiness levels

| Level | Meaning |
|-------|---------|
| Strong alpha | Implemented, documented, tested, useful for serious evaluation |
| Alpha | Implemented and useful, but should be reviewed before production use |
| Experimental | Promising, but still needs broader validation |
| Not recommended yet | Do not rely on it for production-critical behavior |

## Matrix

| Area | Status | Good for now | Needs before critical production |
|------|--------|--------------|----------------------------------|
| Compiler and generated graphs | Strong alpha | AppGraph, DataGraph, RuntimeGraph, PackageGraph, FrontendGraph, deterministic generated artifacts | More large external apps, drift/failure reports |
| Commands and queries | Strong alpha | Local apps, prototypes, internal tools, agent-driven CRUD/features | More production concurrency and database adapter mileage |
| Actions and outbox | Alpha | Post-commit side effects, telemetry, integration sketches | More retry/dead-letter operational reporting |
| Workflows | Alpha | Durable multi-step app workflows and AI triage demos | More cancellation/retry/idempotency field reports |
| LiveQuery | Alpha | Local and production-style reactive UI evaluation | Load testing, reconnect stress, production invalidation monitoring |
| Frontend hooks and capability map | Strong alpha | React/Next/Vite app wiring, agent UI inspection, drift detection | More real-world component patterns and route frameworks |
| Auth JWT/OIDC | Alpha | Evaluation with real tokens, local production-mode checks | External review of claim mapping, issuer/audience/JWKS failure modes |
| Policies and tenant isolation | Alpha | RBAC policies, tenant-scoped app logic, policy simulation | Adversarial bypass tests and production incident playbooks |
| Postgres RLS compiler | Alpha | SQL review, staging validation, DB-enforced tenant isolation experiments | External security review and Postgres integration test matrix |
| Secrets and env | Strong alpha | Secret name registry, redaction, `ctx.secrets`, forbidden `process.env` checks | More provider recipes and secret rotation guidance |
| Package intelligence | Alpha | `forge add`, runtime matrix, import guards, SDK API evidence, upgrade plans | More package ecosystem coverage and bad-package fixtures |
| AI generation | Alpha | Mocked/local workflows, controlled actions/workflows, provider experiments | Cost controls, provider failure playbooks, prompt retention policy review |
| AI tools and agents | Experimental | Internal agents, demos, approval-gated writes, chat UI prototypes | Prompt-injection tests, exfiltration tests, audit/replay hardening |
| Codemods and refactors | Alpha | AST-aware rename/extract workflows with dry-run and rollback | More semantic coverage and language-server-backed validation |
| Repair/review/test tooling | Alpha | Agent development loop, impact tests, structured repair/review | More failure corpus and CI time/performance tuning |
| UI/browser test bridge | Experimental | Local smoke checks and route validation | Playwright browser install coverage in CI and richer assertions |
| Self-host artifacts | Alpha | Compose/check review and local deployment planning | Production deployment reports and platform-specific hardening |
| Release/source-map bridge | Experimental | Release metadata and symbolication bridge evaluation | Real external deployment reports |
| Windows native | Experimental | Diagnostics, setup checks, Node fallback path, smoke testing | Broader native Windows field reports |
| Node runtime path | Alpha | CLI/runtime smoke outside Bun, npm package validation | More Node-only app development mileage |
| npm package and create app | Strong alpha | Public alpha installs, `npm create forgeos-app@alpha`, template smoke, runtime field probes | More package manager and platform field reports |
| Release dependency audit | Strong alpha | `npm run security:deps`, release evidence JSON, explicit waiver file | More ecosystem coverage and signed artifact retention |

## Recommended usage today

ForgeOS is reasonable to use for:

- evaluating agent-native app workflows;
- internal prototypes;
- local-first apps;
- demos and early product experiments;
- AI coding agent workflow research;
- non-critical internal tools with review;
- staging validation of auth, policies, RLS, and liveQuery.

ForgeOS should not yet be used without extra review for:

- regulated data workloads;
- unattended destructive AI agents;
- high-value financial workflows;
- public multi-tenant production without independent security review;
- workloads where downtime, authorization bugs, or data leaks have severe impact.

## Minimum production checklist

Before using ForgeOS in a serious production environment:

```bash
forge generate --check
forge check --json
forge auth check --json
forge policy check --strict-policies --json
forge secrets check --json
forge rls check --json
forge inspect capabilities --json
forge inspect live-production --json
npm run security:deps
forge verify --strict
```

Also do manual review:

- confirm production auth mode is `jwt` or `oidc`, not `dev-headers`;
- review generated RLS SQL before applying it;
- test tenant isolation with at least two tenants;
- test policy denied paths from the UI and API;
- verify secret values never appear in generated files, traces, logs, or frontend bundles;
- verify commands do not call network packages, secrets, or AI;
- review all AI tools with `risk`, `needsApproval`, and tenant scope in mind;
- run a staging deployment before public traffic.

## Agent safety checklist

For any production-facing AI tool or agent:

- default command auto-tools to approval-required writes;
- require explicit approval for destructive or external actions;
- cap max steps and tool calls;
- avoid prompt/output retention unless intentional;
- scrub traces and telemetry;
- test prompt injection attempts;
- test cross-tenant data access attempts;
- test tool confusion, for example asking a read tool to mutate state;
- log trace IDs for audit and debugging.

Useful commands:

```bash
forge inspect agent-tools --json
forge ai tools --json
forge ai agents --json
forge ai trace <traceId> --json
```

## What would move ForgeOS toward beta

The biggest readiness improvements are:

1. More external field-test reports across operating systems and package managers.
2. Continued expansion of the public [Threat Model](threat-model.md), especially around auth, RLS, policies, secrets, generated artifacts, package guards, and AI tools.
3. Adversarial tests for agent tools, tenant isolation, prompt injection, and secret leakage.
4. Production-like showcase deployments with incident notes and known limits.
5. Broader UI/browser test coverage in CI.
6. More package recipes and package compatibility fixtures.
7. More semantic codemod coverage for real app refactors.

## Field-test evidence expected before promotion

Before moving a release beyond alpha, collect at least one passing field-test report for:

- Linux, macOS, and Windows;
- Node 22 and Node 24;
- npm, pnpm, yarn, and Bun where the package manager is available;
- `minimal-web` with runtime probes;
- `b2b-support-web` with runtime probes before announcing frontend/runtime changes.

Use:

```bash
npm run field:test -- \
  --package-managers npm,pnpm,yarn,bun \
  --templates minimal-web,b2b-support-web \
  --forge-spec "npm:forgeos@alpha" \
  --install \
  --runtime-probes \
  --write-report field-reports/full-alpha.json \
  --json
```

A report should show successful scaffold, install, generate, `forge dev --once`, `forge verify --smoke`, `GET /health`, `GET /entries`, one command invocation, and one query invocation.

## Related pages

- [Security and Data](security-and-data.md)
- [Threat Model](threat-model.md)
- [Operations](operations.md)
- [Field Testing](field-testing.md)
- [Self-Host](self-host.md)
- [AI Agents](ai-agents.md)
- [Release](release.md)
