# Why ForgeOS

ForgeOS makes a full-stack application legible to AI coding agents.

AI agents can write code, but complex apps need more than code generation. They need a map of the app, runtime rules, safe tools, package knowledge, frontend/backend wiring, diagnostics, and a verification loop. ForgeOS generates those pieces from the repository.

The result is not an autonomous agent and not a mandatory dashboard. The result is an app that explains itself through files and commands that humans and agents can trust.

## TL;DR

After one create command, a ForgeOS app gives an AI coding agent:

| Agent need | ForgeOS answer |
|------------|----------------|
| Understand the app | `agentContract.json`, `appMap.md`, `forge inspect all --json` |
| Choose the next command | `forge do "<objective>" --json` |
| Connect UI and backend | `frontendGraph.json`, `capabilityMap.json`, `forge do connect-ui --json` |
| Avoid unsafe runtime code | `runtimeRules.md`, import guards, `forge check --json` |
| Add integrations safely | `forge add`, recipes, generated adapters, secret registry |
| Use SDKs correctly | PackageGraph, `forge deps api`, runtime compatibility checks |
| Refactor safely | AST-aware codemods, dry runs, impact reports, rollback snapshots |
| Recover from failures | `forge repair diagnose`, `forge repair plan`, `forge doctor` |
| Verify before handoff | `forge verify --standard`, `forge verify --strict` |

The framework is early. The central value is already clear: the app produces a development contract instead of forcing agents to infer one from source conventions.

## The problem

Most frameworks expose source files, framework conventions, a CLI, and runtime behavior. A human developer learns those conventions over time. An AI coding agent must infer them on every task.

That creates predictable failure modes:

- The agent calls a write endpoint from the wrong UI component.
- The agent imports a network SDK inside a transactional command.
- The agent reads `process.env` where secrets must go through runtime APIs.
- The agent edits a generated file instead of the source file.
- The agent changes a table field but misses frontend hooks, policies, tests, or RLS.
- The agent adds a package without understanding which runtime contexts may import it.
- The agent guesses a vendor SDK method from memory and writes code against the wrong API.
- The agent runs an expensive full test suite when a targeted test plan would be enough.

ForgeOS treats these as product problems, not prompt problems.

## The ForgeOS bet

ForgeOS compiles app source into an agent-native layer:

```txt
source code
  -> AppGraph, DataGraph, RuntimeGraph, PackageGraph
  -> frontendGraph, capabilityMap, policyRegistry, secretRegistry
  -> agentContract.json, agentTools.json, runtimeRules.md
  -> inspect, doctor, verify, repair, refactor, dev diagnostics
```

An agent no longer has to read every file first. It can ask the app what exists, what is allowed, what is connected, and how to verify a change.

## The 30-second agent loop

In a Forge app, the first loop is deterministic:

```bash
forge do inspect --json
forge dev --once --json
forge inspect all --json
forge verify --standard
```

Those commands tell an agent:

- which commands, queries, liveQueries, actions, and workflows exist;
- which tables, fields, tenant scopes, policies, and RLS rules protect them;
- which frontend routes and components call which runtime entries;
- which packages are allowed in each runtime context;
- which AI tools and agents are available;
- which generated files are stale;
- which tests are relevant to the current change;
- which command to run next.

This is the core idea: the repository becomes an API for development.

## What makes ForgeOS different

| Need | Common approach | ForgeOS approach |
|------|-----------------|------------------|
| Understand the app | Read source and infer conventions | `forge inspect all --json`, `agentContract.json`, `appMap.md` |
| Choose the next command | Memorize a large CLI | `forge do "<objective>" --json` returns a plan and next action |
| Connect frontend and backend | Manually trace fetches/hooks/routes | `frontendGraph.json` and `capabilityMap.json` connect UI to runtime entries |
| Keep side effects safe | Team convention and code review | Commands are transactional; actions/workflows own side effects |
| Add integrations | `npm install`, then hand-wire env, adapters, docs, tests, and guards | `forge add` applies recipes, emits adapters, registers secrets, and updates generated contracts |
| Use packages safely | Read package docs and guess runtime fit | `PackageGraph`, `runtimeMatrix`, `forge deps api`, import guards |
| Add AI tools | Hand-roll tool loops | `aiTool`, `agent`, auto-tools, approval metadata, telemetry |
| Refactor app structure | Search and replace | AST-aware refactors with impact reports and rollback snapshots |
| Recover from failures | Inspect logs manually | `forge repair diagnose`, `forge repair plan`, `forge doctor` |
| Verify changes | Run everything or guess | `forge impact`, `forge test plan`, `forge verify --standard` |
| Work locally | Separate API/frontend commands | `forge dev` runs API, worker, checks, and web together |

## Generated contract

The agent contract is the center of ForgeOS.

Important files:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/agentTools.json
src/forge/_generated/frontendGraph.json
src/forge/_generated/capabilityMap.json
src/forge/_generated/runtimeRules.md
src/forge/_generated/operationPlaybooks.md
```

These files are generated from source. They are not another place to maintain truth by hand.

For humans, they document the app. For agents, they remove guesswork. A coding agent can inspect a command, see its policy, see which table it writes, see which UI route calls it, see which tests cover the affected area, and see the commands required before handoff.

## Full-stack capability map

ForgeOS treats frontend wiring as part of the app contract.

The compiler records:

- routes and components under `web/`;
- `ForgeProvider` and bridge files such as `web/lib/forge.ts`;
- usage of `useCommand`, `useQuery`, and `useLiveQuery`;
- raw runtime fetches that bypass generated hooks;
- runtime entries that have no UI caller;
- UI actions that reference missing backend entries.

That matters because many AI coding failures happen between the UI and backend. ForgeOS gives agents direct commands for this:

```bash
forge inspect frontend --json
forge inspect capabilities --json
forge do connect-ui --json
```

The agent can see how a button maps to a command, which policy protects that command, which table the command writes, and which liveQuery should update the screen.

## Runtime guardrails

ForgeOS separates runtime contexts by design:

| Context | Purpose | Important rules |
|---------|---------|-----------------|
| Command | Transactional writes | Use `ctx.db` and `ctx.emit`; no network, secrets, or AI |
| Query | Read-only reads | No writes, emits, secrets, network, or AI |
| LiveQuery | Read-only subscriptions | Tenant-scoped, backed by durable invalidations |
| Action | Side effects after commit | Network packages, secrets, and AI are allowed |
| Workflow | Durable orchestration | Steps persist output and can retry |
| Endpoint/server | Integration boundary | Auth, secrets, and external APIs belong here |

`forge check --json` enforces those rules. This turns architectural convention into machine-readable diagnostics.

## Native AI tools and agents

ForgeOS uses the Vercel AI SDK v6 as the model and tool execution engine. Forge adds the app-native layer around it:

- `aiTool` for explicit app tools;
- `agent` for reusable agent definitions;
- `ctx.agent.run` and `ctx.ai.runAgent` in allowed runtime contexts;
- auto-tools for commands, queries, and liveQueries;
- approval metadata for write tools;
- `/ai/agents/run` for JSON automation;
- `/ai/agents/chat` for AI SDK UIMessage streaming;
- `forge ai trace <traceId> --json` for inspection;
- telemetry without prompt/output retention by default.

This means agents do not need ad hoc database access. They call tools that run through the same runtime boundaries as the rest of the app: auth, tenant scope, policies, command approval, telemetry, and verification.

## Package intelligence

Agents often fail when they guess SDK APIs, install packages without guard metadata, or import packages into the wrong runtime. ForgeOS treats package installation as part of the app contract, not as a side effect of `npm install`.

`forge add` is the integration entry point:

```bash
forge add stripe --dry-run --json
forge add stripe
forge generate
forge check --json
```

For known recipes, Forge can install dependencies, emit generated adapters, register secret names, update runtime compatibility, document safe usage, and refresh the agent-readable contract. That means an agent adding Stripe, PostHog, Sentry, Zod, or AI SDK support does not have to remember every file that must change.

The output is visible in:

- `PackageGraph` for exports, types, and dependency metadata;
- `runtimeMatrix.json` for allowed and denied runtime contexts;
- `importGuards.json` for `forge check`;
- `secretRegistry.json` for required secret names;
- `agentContract.json` for agent-facing package and dependency summaries.

ForgeOS builds package intelligence into the project:

```bash
forge deps inspect stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps trace stripe --json
forge deps runtime-compat stripe --json
```

The DepLens-inspired dependency API oracle gives agents package-level evidence: resolved entry points, subpath traces, exported symbols, signatures, JSDoc, examples when available, runtime compatibility, and placement hints. Import guards then enforce those decisions in `forge check`.

This is useful for integrations such as Stripe, PostHog, Sentry, Zod, and AI SDK providers. It also helps agents avoid reading all of `node_modules` or relying on stale model memory to answer one API question.

See [forge add](forge-add.md) for the full integration workflow and dependency API commands.

## Safe change tools

ForgeOS includes refactor and authoring commands designed for app-wide edits:

```bash
forge make resource tickets --fields title:text,status:enum(open,closed) --with-ui --dry-run --json
forge refactor rename command createTicket openTicket --dry-run --json
forge refactor rename field tickets.priority tickets.urgency --dry-run --json
forge refactor rename table tickets supportTickets --dry-run --json
forge refactor extract-action chargeCustomer --package stripe --dry-run --json
```

These commands produce plans before writing. The safer paths use AST-aware rewrites, impact reports, generated artifact lists, and rollback snapshots.

This matters because agent edits are not only about adding new code. Agents also need to rename, move, split, extract, and repair existing code without breaking policies, generated clients, frontend hooks, or tests.

## Repair and verification loop

ForgeOS gives agents a structured path after something fails:

```bash
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
forge verify --standard
```

The output is machine-readable. It includes failure kinds, likely causes, suggested commands, and deterministic repairs when confidence is high.

For handoff, `forge verify --strict` remains the full gate. For normal agent work, `forge verify --standard` uses generated drift checks, Forge checks, typecheck, and impact-selected tests to keep feedback faster.

## Local-first dev loop

`forge dev` is the local control panel:

```bash
forge dev
forge dev --once --json
```

When a web app exists, `forge dev` starts the API runtime, database adapter, outbox worker, checks, and web dev server together. It prints API and web URLs, phase health, frontend wiring diagnostics, capability map coverage, cache state, and next actions.

`forge dev --once --json` gives agents the same information as a deterministic snapshot. This reduces command-selection risk: agents do not have to guess which of many CLI commands applies first.

## Dashboard optional, contract required

ForgeOS does not require a dashboard to be agent-native.

Dashboards are useful for humans. Agents need stable text, JSON, generated maps, command output, and reproducible checks. ForgeOS puts those artifacts in the repository and CLI so they can be versioned, reviewed, tested, and used in CI.

Self-hosting follows the same idea:

```bash
forge self-host compose
forge self-host check --json
```

The deploy shape is generated and inspectable instead of hidden behind a mandatory hosted control plane.

## ForgeOS vs Convex + Next.js

Convex is a strong managed backend. It gives teams hosted persistence, reactive queries, a mature dashboard, and a polished product loop. Choose Convex when you want a managed backend and want Convex to own the operational surface.

Next.js is a strong full-stack React framework. It gives routing, rendering, API/server primitives, and deployment paths. Choose Next.js when your main need is a React application framework.

ForgeOS is different. It focuses on the contract around the whole app:

- generated app maps instead of source-only inference;
- explicit command/query/action/workflow boundaries;
- frontend/backend capability maps;
- package runtime compatibility;
- agent tools derived from app runtime entries;
- repair, refactor, review, and impact-test loops;
- local/self-host posture without a mandatory dashboard.

You can still use a web framework for the UI. ForgeOS is the app contract, runtime, compiler, guardrail, and agent workflow layer around it.

## Best fit

ForgeOS fits projects where:

- AI coding agents will make real changes across backend and frontend.
- Runtime boundaries matter.
- Policies, tenant scope, RLS, and secrets must be visible to tooling.
- The team wants generated contracts and playbooks in version control.
- The app needs local-first or self-hosted operation.
- Frontend/backend drift is a recurring risk.
- Agent edits must finish with deterministic verification.

## Current tradeoffs

ForgeOS is an alpha framework. It already has a compiler, local runtime, frontend SDK, liveQuery, auth, RLS, AI tools, generated contracts, repair/review loops, safe refactors, templates, and npm alpha publishing.

The tradeoff is ecosystem maturity. Convex, Next.js, and other established tools have larger communities, more examples, and more production mileage. ForgeOS is strongest when the agent-native contract matters enough to accept an early platform.

## When not to choose ForgeOS

Choose another path if:

- you want a mature hosted backend first;
- you do not need AI coding agents to operate the app;
- you prefer dashboard-managed operations over repository-native contracts;
- you do not want an alpha framework in the stack;
- simple CRUD with a familiar framework solves the problem.

## Next steps

- [Getting Started](getting-started.md) - create the first app.
- [Agent Workflow](agent-workflow.md) - use `forge do`.
- [Agent Contract](agent-contract.md) - inspect generated context.
- [Frontend](frontend.md) - connect routes, hooks, and runtime entries.
- [AI](ai.md) - define tools and agents.
- [Testing and Repair](testing-and-repair.md) - verify and recover changes.
