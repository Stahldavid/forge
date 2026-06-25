# Stable Alpha Surface

ForgeOS is an alpha project with a deliberately smaller public core than its long-term roadmap. Treat this page as the current adoption boundary: what is supported for serious alpha evaluation, what is experimental, and what should not be used for production-critical work yet.

## Public core

The public core is:

> Generate a trusted contract of your app so coding agents can understand, modify, and verify it safely.

That core includes the compiler, generated agent contract, runtime boundary checks, frontend/backend capability map, package intelligence, and verification loop. Other surfaces are useful, but should be evaluated as extensions until they have more external mileage.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| `forge generate` | Supported alpha | Deterministic generated contract, clients, graphs, and registries. |
| `forge check` | Supported alpha | Static guardrails for runtime placement, generated drift, frontend wiring, policies, secrets, and packages. |
| `forge verify --smoke` | Supported alpha | Fast release and generated-app smoke gate. |
| `forge verify --standard` | Supported alpha | Normal development gate for changed files and impact-selected tests. |
| `minimal-web` template | Supported alpha | Primary public starter for agent-readable full-stack evaluation. |
| `npm create forgeos-app@alpha` | Supported alpha | Public app creation path; use the `@alpha` tag explicitly. |
| React/Vite SDK | Alpha | Primary frontend SDK path for generated hooks and liveQuery evaluation. |
| Next/React template surface | Alpha | Available through templates and generated hooks; expect more field reports before beta. |
| Vue/Nuxt SDK | Experimental alpha | Useful for evaluation; not the first production recommendation. |
| `agent-workroom` template | Experimental alpha | Good for demos and agent-native research; not the minimum adoption path. |
| Native AI tools and agents | Experimental alpha | Use for controlled actions, workflows, and demos with explicit approval gates. |
| MCP server and external agent memory | Experimental | Useful locally; do not treat it as a required adoption dependency. |
| Studio/workroom UI | Experimental | Helpful for exploration, not required for the core contract loop. |
| Brownfield import | Experimental alpha | Useful for app inventory and migration planning; review generated output manually. |
| Go/Java protocol adapters | Experimental alpha | Good for external-runtime experiments; not the primary first app path. |
| Production multi-tenant workloads | Not recommended yet | Require independent security review, tenant isolation tests, and production incident playbooks. |

## First evaluation path

Use this path when evaluating ForgeOS from scratch:

```bash
npm create forgeos-app@alpha notes-app -- --template minimal-web --no-git
cd notes-app
npm run generate
npm run forge -- dev --once --json
npm run forge -- verify --smoke --json
```

Then ask an agent to inspect the app and make one small safe change:

```bash
forge do inspect --json
forge inspect capabilities --json
forge test plan --changed --json
forge verify --standard
forge handoff --json
```

## What is not the core yet

Do not make the first adoption decision depend on:

- Studio as a required dashboard;
- MCP as a required workflow;
- polyglot adapters as the default path;
- unattended destructive AI agents;
- public multi-tenant production without a review.

Those surfaces matter, but the adoption question should start with whether the generated contract and verification loop make a real app safer for agents to change.

## Related pages

- [AI Coding with ForgeOS](ai-coding-with-forgeos.md)
- [Agent Contract](agent-contract.md)
- [Testing and Repair](testing-and-repair.md)
- [Production Readiness](production-readiness.md)
