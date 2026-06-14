# __FORGE_APP_TITLE__

Minimal full-stack ForgeOS app.

Run the full-stack loop:

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run dev
```

`forge dev` starts both the Forge runtime API and the web UI.

For agent/CI diagnostics:

```bash
__PACKAGE_MANAGER__ run forge -- dev --once --json
```

Generated files and local runtime state are gitignored and hidden from editor search by default. Recreate them with `forge generate`.
