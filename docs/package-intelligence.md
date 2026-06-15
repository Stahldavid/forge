# Package Intelligence

ForgeOS treats packages as part of the application contract.

A package install can change runtime safety, secrets, generated adapters, tests, and agent behavior. ForgeOS makes those effects visible through recipes, PackageGraph, runtime compatibility, import guards, and dependency API summaries.

## Start with forge add

For known integrations:

```bash
forge add stripe --dry-run --json
forge add stripe --json
forge generate
forge check --json
```

`forge add` can:

- install npm packages;
- apply a recipe;
- emit generated adapters;
- register secret names;
- update `runtimeMatrix.json`;
- update `importGuards.json`;
- update `secretRegistry.json`;
- update package summaries in `agentContract.json`.

Prefer it over manual `npm install` for recipe-backed integrations.

## Inspect a package

```bash
forge deps inspect stripe --json
```

Use this when an agent needs package version, export summary, classification, or diagnostics.

## Look up an API symbol

```bash
forge deps api stripe checkout.sessions.create --json
forge deps api @ai-sdk/openai createOpenAI --json
```

Use this before writing provider SDK calls. The output gives signatures, JSDoc, examples when available, and runtime placement hints.

## Trace resolution

```bash
forge deps trace stripe --json
```

This explains entry points, subpath exports, declaration files, and resolution decisions.

## Check runtime compatibility

```bash
forge deps runtime-compat stripe --json
```

This answers where the package may run:

| Context | Typical integration rule |
|---------|--------------------------|
| `command` | Network packages denied |
| `query` | Network packages denied |
| `liveQuery` | Network packages denied |
| `action` | Network packages allowed when recipe permits |
| `workflow` | Network packages allowed when recipe permits |
| `endpoint` | Network packages allowed when recipe permits |
| `client` | Browser-safe packages only |

Type-only imports can be allowed where runtime imports are denied.

## Plan upgrades

```bash
forge deps outdated --json
forge deps upgrade-plan stripe --to latest
forge deps upgrade-apply .forge/upgrades/<plan>.json
```

Upgrade plans should be reviewed before apply. After applying:

```bash
forge generate
forge check --json
forge verify --standard
```

## Agent workflow

When an AI coding agent needs a package:

```bash
forge do "add stripe checkout" --json
forge add stripe --dry-run --json
forge add stripe --json
forge deps api stripe checkout.sessions.create --json
forge deps runtime-compat stripe --json
forge check --json
```

The agent should not call an SDK from memory when local package evidence is available.

## Related pages

- [forge add](forge-add.md)
- [Recipes](recipes.md)
- [CLI](cli.md)
- [Agent Contract](agent-contract.md)
- [Payments](payments.md)
