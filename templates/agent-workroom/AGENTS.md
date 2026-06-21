# AGENTS.md

This ForgeOS app is an agent workroom. External code agents edit the app in this
directory while ForgeOS records context, hooks, checks, generated artifacts, and
handoff state.

Before editing:

```bash
forge dev --once --json
forge agent print-context --json
forge check --json
```

After editing:

```bash
forge generate
forge check
forge verify agent
```

Do not edit:

- `src/forge/_generated/**`
- `forge.lock`

Use `forge studio attach . --target codex --preview-port 5174` to connect this
workspace to Forge Studio.
