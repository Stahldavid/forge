# __FORGE_APP_TITLE__

A production-shaped ForgeOS field-test app for vendor access approvals.

Run the full-stack loop:

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run dev
```

The template's `dev` script runs `forge dev --seed --all-tenants`: it starts both the Forge runtime API and the web UI,
then refreshes every local test organization through the generated seed command.

The app starts with local test identities and idempotent local seed data. Add hosted
WorkOS/AuthKit when you are ready to test real login:

```bash
__PACKAGE_MANAGER__ run forge -- add auth workos --json
__PACKAGE_MANAGER__ run forge -- workos doctor --json
```

For agent/CI diagnostics:

```bash
__PACKAGE_MANAGER__ run forge -- dev --once --json
```

Generated files and local runtime state are gitignored and hidden from editor search by default. Recreate them with `forge generate`.
