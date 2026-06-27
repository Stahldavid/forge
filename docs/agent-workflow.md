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
| New external agent entering the repo | `forge agent onboard --target codex --json` |
| Need project health first | `forge status --json` |
| Need to understand the current diff | `forge changed --json` |
| Switching agents or resuming work | `forge handoff --json` |
| Need agent context first | `forge agent print-context --json` |

Prefer `forge do` **before** jumping to lower-level commands like `forge refactor`, `forge make`, or `forge add`.

`forge handoff --json` is the best first read for a new external agent. It includes the dev snapshot plus a categorized git summary, so an agent can tell whether the current work is mostly source edits, tests, docs, generated artifacts, operational hook files, assets, or config.

Use `forge changed --json` when the worktree is large. It gives the agent the human-authored surface first, separates generated artifacts, flags untracked or uncategorized paths, and returns the focused verification commands to run next.

For Codex Desktop workrooms, `forge studio snapshot` and `forge studio doctor` also report the optional `codex app-server` surface. The hook bridge remains the baseline because it works while the user keeps coding in Codex, Claude Code, or Cursor. The app-server proof is the Codex-specific deeper path: it tells Studio whether version-matched schemas can be generated and whether a Studio-owned Codex process can expose real thread, turn, approval, terminal, MCP, and file-change events. With `--probe-codex-server`, ForgeOS also proves safe read-only `model/list` and `account/read` RPCs after initialization, storing only sanitized readiness metadata.

## Basic usage

```bash
forge agent onboard --target codex --json
forge do inspect --json
forge status --json
forge changed --json
forge handoff --json
forge do "add stripe checkout flow" --json
forge do fix --json
forge do verify --json
forge do connect-ui --json
```

Always pass `--json` when an AI agent is driving the session. The response is machine-readable and includes fix hints.

## Compact code navigation and edits

Use CAIR when the agent needs code context or wants to apply a guarded edit without spending tokens on whole files:

```bash
forge cair snapshot
forge cair query "Q S name=createTicket"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
forge cair action --plan "A RN t=S#1 nn=openTicket"
forge cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
```

CAIR v0.5 keeps both readable verbs and compact aliases. Prefer `Q D/R/I` before opening source, use `--plan` before mutation, and keep the returned journal path for rollback.

## Observe a Codex workroom

```bash
forge studio open . --preview-port 5174 --target codex --json
forge studio snapshot . --preview-port 5174 --target codex --json
forge studio snapshot . --preview-port 5174 --target codex --probe-codex-server --json
forge studio doctor . --preview-port 5174 --target codex --probe-codex-server --json
forge studio codex-server . --json
forge studio codex-server . --write --json
forge studio codex-server . --probe --json
```

Look for:

| JSON path | Meaning |
|-----------|---------|
| `proofs.hooks` | Whether native hook events are installed, trusted, and visible in Agent Memory |
| `proofs.codexAppServer` | Whether `codex app-server` is available, whether the optional stdio handshake initialized, whether read-only protocol probes responded, and which schema/connect/probe commands to use |
| `proofs.delta` | Whether Forge DeltaDB can read the durable event ledger |
| `preview.status` | Whether the target app preview is reachable |
| `contextPacket.commands` | Commands the next external agent should run before editing |

## Feature change loop

For app changes that touch backend and frontend, use this loop:

```bash
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge dev --once --json
forge make resource task --fields title:text,status:enum=open+done --with-ui --dry-run --json
forge make resource task --fields title:text,status:enum=open+done --with-ui --yes
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
| `commands` | Exact CLI commands to run next |
| `nextAction` | Single recommended next command |

Example workflow for an agent:

```txt
1. forge do inspect --json
2. forge changed --json
3. Read filesToInspect
4. Run commands from the plan
5. forge generate && forge check --json
6. forge do verify --json
7. forge verify --strict
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
  "commands": [
    "forge status --json",
    "forge changed --json",
    "forge handoff --json",
    "forge agent print-context --json",
    "forge inspect all --brief --json"
  ],
  "nextAction": "forge status --json"
}
```

## Common objectives

### Inspect before editing

```bash
forge do inspect --json
```

Equivalent to starting with:

```bash
forge status --json
forge changed --json
forge handoff --json
forge dev --once --json
forge agent print-context --json
forge agent hooks status --target codex --json
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

When generated artifacts are noisy, use `forge changed --authored --json` or `diffPlan.authoredDiffCommand` to review the human-authored surface first. Do not add generated cleanup commands to the workflow unless the repository has deliberately decided to ignore or untrack those artifacts. See [Generated Artifacts](generated-artifacts.md).

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
