# CAIR Protocol

CAIR is ForgeOS' compact agent interface for reading code structure, querying symbols, and planning safe edits without loading the whole repository into an agent context window.

CAIR is intentionally CLI-first. It does not add a second mutating tool surface. Agents should use CAIR to inspect structure and create reviewable plans, then apply those plans through the ForgeOS CLI with hash checks and rollback journals.

## Read Workflow

Start with a compact snapshot:

```bash
forge cair snapshot
forge cair query "Q STATUS"
forge cair query "Q ST"
```

Use symbol, definition, reference, impact, and dependency API queries before opening large files:

```bash
forge cair query "Q S name=createTicket"
forge cair query "Q D S#1"
forge cair query "Q R S#1"
forge cair query "Q I S#1"
forge cair query "Q DEP.API package=zod symbol=object"
```

The goal is to make agent navigation evidence-backed: CAIR gives stable ids for modules, symbols, packages, APIs, and tests so an agent can select a small file set instead of scanning the whole project.

## Action Safety

Mutating CAIR actions should be planned first:

```bash
forge cair action --plan "A RN t=S#1 nn=openTicket"
```

The plan lives under `.forge/cair/plans/` and records the target files and expected hashes. Applying a plan checks those hashes before editing:

```bash
forge cair action "A APPLY plan=<P#|.forge/cair/plans/...json>"
```

Applied plans write rollback journals under `.forge/cair/journal/`:

```bash
forge cair action "A ROLLBACK journal=.forge/cair/journal/<journal>.json"
```

Use `--dry-run` when exploring an action shape without creating a plan:

```bash
forge cair action --dry-run "A CREATE.SYMBOL path=src/example.ts kind=function name=example export=true createFile=true"
```

Generated files stay protected by default. Use `--include-generated` only when the edit is intentionally about generated artifacts.

## DeltaDB Evidence

Successful CAIR CLI runs are recorded in DeltaDB as sanitized operational events:

| CAIR command | Delta event |
|--------------|-------------|
| `forge cair snapshot` | `cair.snapshot.created` |
| `forge cair query ...` | `cair.query.run` |
| `forge cair action --plan ...` | `cair.plan.created` |
| `forge cair action "A APPLY ..."` | `cair.plan.applied` |
| `forge cair action --dry-run ...` | `cair.action.previewed` |

The recorder stores compact verbs such as `Q ST` or `A APPLY`; it does not need to store full action bodies as first-class timeline data. Use:

```bash
forge timeline cair:protocol --json
forge timeline --kind cair.plan.applied --json
```

This makes CAIR navigation and guarded edits visible beside file changes, proofs, and agent activity.

## Compact Aliases

| Long form | Compact |
|-----------|---------|
| `Q STATUS` | `Q ST` |
| `Q SYMBOL` | `Q S` |
| `Q DEF` | `Q D` |
| `Q REFS` | `Q R` |
| `Q IMPACT` | `Q I` |
| `A RENAME.SYMBOL target=S#1 newName=x` | `A RN t=S#1 nn=x` |

## Agent Posture

Use this loop for code work:

```bash
forge cair snapshot
forge cair query "Q ST"
forge cair query "Q S name=<symbol>"
forge cair query "Q I S#1"
forge cair action --plan "A RN t=S#1 nn=<newName>"
forge cair action "A APPLY plan=<P#|path>"
forge check --json
```

Do not use CAIR as a bypass around ForgeOS rules. Commands remain transactional writes, queries and liveQueries remain read-only, side effects still belong in actions and workflows, and generated artifacts remain derived.
