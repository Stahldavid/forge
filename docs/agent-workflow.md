# Agent Workflow (`forge do`)

ForgeOS is **agent-native**: before editing files manually, humans and coding agents should ask Forge which workflow fits the objective.

`forge do` is the **intent router**. It returns a structured plan instead of forcing you to memorize dozens of CLI commands.

## When to use it

| Situation | Command |
|-----------|---------|
| You know the goal but not the steps | `forge do "<objective>" --json` |
| Something failed | `forge do fix --json` |
| Ready to hand off a change | `forge do verify --json` |
| Frontend wiring looks wrong | `forge do connect-ui --json` |
| Need project context first | `forge do inspect --json` |

Prefer `forge do` **before** jumping to lower-level commands like `forge refactor`, `forge make`, or `forge add`.

## Basic usage

```bash
forge do inspect --json
forge do "add stripe checkout flow" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

Always pass `--json` when an AI agent is driving the session. The response is machine-readable and includes fix hints.

## Feature change loop

For app changes that touch backend and frontend, use this loop:

```bash
forge do inspect --json
forge dev --once --json
forge make resource task --fields title:text,status:enum(open,done) --with-ui --dry-run --json
forge make resource task --fields title:text,status:enum(open,done) --with-ui --yes
forge generate
forge check --json
forge inspect capabilities --json
forge verify --standard
```

This keeps the agent out of generated files, verifies frontend wiring, and reserves `forge verify --strict` for final handoff.

See [Build a Feature with an Agent](agent-feature-tutorial.md) for the full walkthrough.

## Integration change loop

For features that need a package or provider SDK, keep installation inside the Forge contract:

```bash
forge do "add stripe checkout flow" --json
forge add stripe --dry-run --json
forge add stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps runtime-compat stripe --json
forge generate
forge check --json
forge verify --standard
```

`forge add` is more than a package install. It applies the integration recipe, writes generated adapters, registers secret names, updates the runtime matrix, and feeds the agent contract. `forge deps api` is the API oracle for the next edit: it returns signatures, JSDoc, examples when available, and placement hints so the agent does not guess SDK calls from memory.

Use this loop for Stripe, PostHog, Sentry, Zod, AI SDK providers, and any future recipe-backed integration.

## Response shape

A typical `forge do` JSON response includes:

| Field | Meaning |
|-------|---------|
| `intent` | What Forge understood you want to accomplish |
| `plan` | Ordered steps to reach the goal |
| `filesToInspect` | Source files worth reading first |
| `filesToChange` | Likely edit targets |
| `risks` | Schema, policy, UI, or integration risks |
| `concreteCommands` | Exact CLI commands to run next |
| `nextAction` | Single recommended next command |

Example workflow for an agent:

```txt
1. forge do inspect --json
2. Read filesToInspect
3. Run concreteCommands from the plan
4. forge generate && forge check --json
5. forge do verify --json
6. forge verify --strict
```

Example JSON excerpt:

```json
{
  "ok": true,
  "intent": "inspect",
  "filesToInspect": [
    "AGENTS.md",
    "src/forge/_generated/agentContract.json",
    "src/forge/_generated/runtimeRules.md"
  ],
  "concreteCommands": [
    "forge dev --once --json",
    "forge inspect all --json",
    "forge check --json"
  ],
  "nextAction": "forge dev --once --json"
}
```

## Common objectives

### Inspect before editing

```bash
forge do inspect --json
```

Equivalent to starting with:

```bash
forge dev --once --json
forge inspect all --json
forge check --json
```

### Fix a failure

```bash
forge do fix --json
```

Use after `forge check`, `forge verify`, or a failed test run. Often leads to:

```bash
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

See [Testing and Repair](testing-and-repair.md).

### Verify before handoff

```bash
forge do verify --json
```

Routes to the appropriate verification gate (`--smoke`, `--standard`, or `--strict`) based on context.

See [CLI — Verification](cli.md#verification).

### Connect UI to backend

```bash
forge do connect-ui --json
```

Use when routes, hooks, or capability-map bindings are missing. Often leads to:

```bash
forge inspect frontend --json
forge inspect capabilities --json
forge dev --once --json
```

See [Frontend](frontend.md).

## Relationship to generated playbooks

Human-readable playbooks live in:

- `AGENTS.md`
- `src/forge/_generated/operationPlaybooks.md`
- `src/forge/_generated/agentContract.json` → `playbooks`

`forge do` is the **runtime router**; playbooks are the **static reference**. Use both:

1. `forge do` to choose the path.
2. Playbooks for detailed step lists (add command, add liveQuery, upgrade package, etc.).

## Rules for agents

Do not edit generated files directly:

```txt
src/forge/_generated/**
forge.lock
```

After source changes:

```bash
forge generate
forge check --json
forge verify --standard
```

Finish release-grade work with `forge verify --strict`.

## Related pages

- [Agent Contract](agent-contract.md) — contract files and adapter export
- [Agent Playbook](agent-playbook.md) — issue-to-handoff operating loop
- [Dev Loop](dev-loop.md) — `forge dev` and `forge dev --once --json`
- [CLI](cli.md) — full command reference
- [forge add](forge-add.md) — integration recipes and dependency API oracle
- [Frontend](frontend.md) — hooks, capability map, liveQuery
- [Testing and Repair](testing-and-repair.md) — impact tests and repair loop
