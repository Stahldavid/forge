# Agent Playbook

This is the default issue-to-handoff loop for AI coding agents working in a ForgeOS app.

The goal is simple: inspect first, edit source files only, regenerate, check, repair structurally, and verify before handoff.

## 1. Inspect

Start with project context:

```bash
forge do inspect --json
forge dev --once --json
forge inspect all --json
forge check --json
```

Read:

```txt
AGENTS.md
src/forge/_generated/agentContract.json
src/forge/_generated/runtimeRules.md
src/forge/_generated/appMap.md
```

Do not edit generated files directly.

## 2. Choose the workflow

Use `forge do` before picking low-level commands:

```bash
forge do "add a task list with live updates" --json
forge do "connect the tickets UI to liveTickets" --json
forge do "add stripe checkout" --json
forge do fix --json
forge do verify --json
```

The response gives intent, files to inspect, likely files to change, risks, concrete commands, and the next action.

## 3. Change source

Common edit targets:

```txt
src/commands/**
src/queries/**
src/actions/**
src/workflows/**
src/forge/schema.ts
src/policies.ts
web/**
```

Avoid:

```txt
src/forge/_generated/**
forge.lock
.forge/**
```

## 4. Add integrations safely

Do not start with `npm install` for known integrations:

```bash
forge add stripe --dry-run --json
forge add stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps runtime-compat stripe --json
```

This gives the agent package API evidence, runtime placement hints, adapters, secret names, and guard metadata before writing SDK code.

## 5. Regenerate and check

```bash
forge generate
forge check --json
```

If the change touches frontend:

```bash
forge inspect frontend --json
forge inspect capabilities --json
```

## 6. Plan targeted tests

```bash
forge impact --changed --json
forge test plan --changed --json
forge test run --changed --timeout-ms 120000 --json
```

Use targeted tests for the normal development loop. Save full strict verification for final handoff or CI.

## 7. Repair failures structurally

When something fails, use the repair loop:

```bash
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

For UI failures:

```bash
forge repair diagnose --from-last-ui-run --json
```

Apply deterministic high-confidence repairs automatically. Review lower-confidence repairs before editing.

## 8. Review

```bash
forge review run --changed --json
```

The structured review should focus on correctness, runtime boundaries, policy/tenant safety, generated drift, test gaps, and handoff readiness.

## 9. Verify and hand off

Normal agent handoff:

```bash
forge verify --standard
```

Release-grade handoff:

```bash
forge verify --strict
```

If verification times out, keep the timeout explicit:

```bash
forge verify --strict --script-timeout-ms 1800000 --json
```

## Done criteria

A change is ready when:

- source files, not generated files, were edited;
- `forge generate` was run after source changes;
- `forge check --json` has no blocking diagnostics;
- frontend capability gaps are explained or fixed;
- targeted tests or `forge verify --standard` passed;
- high-risk schema, policy, auth, secret, package, or AI changes were reviewed.

## Related pages

- [Agent Workflow](agent-workflow.md)
- [Agent Contract](agent-contract.md)
- [Dev Loop](dev-loop.md)
- [Testing and Repair](testing-and-repair.md)
- [Codemods](codemods.md)
