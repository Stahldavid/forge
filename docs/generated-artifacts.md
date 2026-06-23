# Generated Artifacts

ForgeOS treats generated files as derived evidence. Source files, config, tests,
and documentation authored by humans are the primary review surface.

## App Repositories

Template apps should normally ignore generated artifacts:

```gitignore
src/forge/_generated/
forge.lock
```

Run `forge generate` after clone, dependency changes, schema changes, or source
changes that affect the Forge contract. CI should run `forge generate --check`
before `forge check`.

## Framework Checkout

The ForgeOS framework checkout may keep generated artifacts available for
compiler, release, and agent-contract tests, but routine agent commits should not
include environment-dependent generated churn unless the change intentionally
updates the generated contract snapshots.

Use:

```bash
forge changed --json
forge changed --authored --json
forge generate --check --json
```

`forge changed --json` separates authored files from generated artifacts.
Generated metadata-only changes, such as an `@forge-generated` header hash
change, are treated as generated output rather than authored documentation.

## Tracking Policy Changes

`.gitignore` does not affect files that Git already tracks. Moving a repository
from tracked generated artifacts to ignored generated artifacts requires a
deliberate migration such as `git rm --cached` for the chosen paths, plus CI and
release checks that regenerate and validate the required artifacts.

Do not add cleanup commands that silently restore generated files. Prefer an
explicit repository policy: either track the generated snapshots that reviewers
must inspect, or ignore them and make generation/checks authoritative.
