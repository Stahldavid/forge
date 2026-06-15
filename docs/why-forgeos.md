# Why ForgeOS

ForgeOS is for teams that want AI coding agents to edit full-stack apps with less guesswork.

Most frameworks expose source files, a CLI, and runtime behavior. ForgeOS adds a generated contract around the app: what commands exist, which policies protect them, which tables they touch, which frontend routes call them, which packages are safe in each runtime, and which checks prove a change is safe.

## What makes it different

| Need | Typical framework | ForgeOS |
|------|-------------------|---------|
| Understand app shape | Read source manually | `forge inspect all --json` and `agentContract.json` |
| Choose the next command | Memorize CLI surface | `forge do "<objective>" --json` |
| Add backend + UI together | Wire files manually | `forge make resource --with-ui` |
| Keep side effects safe | Team convention | Runtime guards and command/action separation |
| Debug generated drift | Ad hoc checks | `forge generate --check` and `forge doctor` |
| Let agents call app tools | Custom loop | `aiTool`, `agent`, auto-tools, and approval metadata |

## ForgeOS vs Convex + Next.js

Convex is a strong managed backend with a reactive database, dashboard, and mature hosted workflow. Choose Convex when you want a managed product with hosted persistence, first-class reactive queries, and less infrastructure ownership.

ForgeOS is different: it is compiler- and contract-first. It can run locally or self-hosted, generates agent-facing context, and keeps runtime rules explicit in files and CLI output. The goal is not to replace a dashboard with another dashboard. The goal is to make the app legible to humans and AI coding agents from the repository itself.

## Best fit

ForgeOS fits projects where:

- AI agents will make real code changes.
- Runtime boundaries matter: commands, queries, liveQueries, actions, workflows, and AI calls have different rules.
- The team wants generated contracts, checks, and playbooks in version control.
- Self-hosting or local-first development matters.
- Frontend and backend wiring should be inspectable, not implicit.

## Current tradeoffs

ForgeOS is still an alpha framework. The generated contract and runtime model are the strength; ecosystem maturity is the tradeoff.

Use ForgeOS when you value explicit contracts, local inspectability, and agent-native workflows. Use a mature managed backend when hosted operations and product polish matter more than repository-native agent context.

## Next steps

- [Getting Started](getting-started.md)
- [Agent Workflow](agent-workflow.md)
- [Agent Contract](agent-contract.md)
- [AI](ai.md)
