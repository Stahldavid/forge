# CLI

ForgeOS has many low-level commands, but most day-to-day work should start with the centered commands below.

## Local Development

```bash
forge dev
forge dev --once --json
```

`forge dev` runs the local backend, worker, checks, and web app when present. `forge dev --once --json` performs a single diagnostic pass and exits.

## Introspection

```bash
forge inspect all --json
forge inspect frontend --json
forge inspect capabilities --json
forge doctor
forge doctor windows --json
```

Use these commands when an agent needs to understand the project before changing it.

## Generation and Verification

```bash
forge generate
forge generate --check
forge check --json
forge verify --standard
forge verify --strict
```

`verify --standard` is the normal development gate. `verify --strict` is the release-grade gate.

## Authoring

```bash
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --yes
forge refactor rename field notes.status notes.state --dry-run --json
forge feature plan .forge/blueprints/example.json
```

Use `--dry-run --json` for plans that touch schema, policies, or UI wiring.
