# Build a Feature with an Agent

This guide shows the preferred workflow when Codex, Cursor, Claude, or another coding agent changes a ForgeOS app.

The key rule: ask ForgeOS for project context before editing files.

## Scenario

You have a generated `minimal-web` app and want to add a task resource with:

- `title`;
- `status`;
- command, query, liveQuery, policy, schema, and UI wiring;
- verification before handoff.

## 1. Ask for project context

```bash
forge do inspect --json
```

The response includes the next useful files and commands. A typical response shape looks like this:

```json
{
  "ok": true,
  "intent": "inspect",
  "plan": [
    "Read AGENTS.md",
    "Inspect generated contract",
    "Check frontend wiring",
    "Run Forge checks before editing"
  ],
  "filesToInspect": [
    "AGENTS.md",
    "src/forge/_generated/agentContract.json",
    "src/forge/_generated/runtimeRules.md",
    "src/forge/_generated/frontendGraph.json"
  ],
  "concreteCommands": [
    "forge dev --once --json",
    "forge inspect all --json",
    "forge check --json"
  ],
  "nextAction": "forge dev --once --json"
}
```

Agents should read `filesToInspect` before writing code.

## 2. Take a deterministic dev snapshot

```bash
forge dev --once --json
```

This reports:

- API and web URLs;
- generated drift;
- frontend routes and components;
- missing bridge or provider wiring;
- capability-map mismatches;
- diagnostics and fix hints.

Use this command instead of guessing whether the backend or frontend is healthy.

## 3. Plan the feature

Use a dry run:

```bash
forge make resource task \
  --fields title:text,status:enum(open,done) \
  --with-ui \
  --dry-run \
  --json
```

Review the plan. The important parts are:

| Plan section | Why it matters |
|--------------|----------------|
| `filesToChange` | Confirms the edit touches source files, not generated files. |
| `runtimeEntries` | Shows commands, queries, and liveQueries the feature will add. |
| `policies` | Shows required access rules. |
| `frontend` | Shows routes/components/bridge changes. |
| `risks` | Flags schema, policy, or UI risks before writing. |

## 4. Apply the feature

```bash
forge make resource task \
  --fields title:text,status:enum(open,done) \
  --with-ui \
  --yes
```

Prefer Forge authoring commands for cross-cutting features because they update source, policies, frontend wiring, and generated expectations together.

## 5. Regenerate

```bash
forge generate
```

Generated files should now include the new runtime entries and frontend bindings:

```txt
src/forge/_generated/agentContract.json
src/forge/_generated/frontendGraph.json
src/forge/_generated/capabilityMap.json
src/forge/_generated/appMap.md
```

Do not edit those files manually.

## 6. Check the app

```bash
forge check --json
forge inspect capabilities --json
```

The check should prove:

- commands run in the command runtime;
- queries and liveQueries stay read-only;
- policies exist for new entries;
- frontend calls resolve to runtime entries;
- no raw runtime fetch bypasses generated hooks.

## 7. Run targeted verification

```bash
forge impact --changed --json
forge test plan --changed --json
forge verify --standard
```

Use `--standard` for the normal agent loop. It is faster than `--strict` and still validates generated drift, Forge checks, typecheck, and impact-selected tests.

## 8. Add integrations only through Forge

If the feature needs a vendor SDK, keep the integration in the generated contract:

```bash
forge add stripe --dry-run --json
forge add stripe --json
forge deps api stripe checkout.sessions.create --json
forge check --json
```

Do this before writing SDK calls. `forge add` records the integration recipe, secrets, adapters, and runtime compatibility. `forge deps api` gives the agent concrete package API evidence so it does not guess method names or runtime placement.

## 9. Repair failures structurally

If a command fails, do not guess:

```bash
forge do fix --json
forge repair diagnose --from-last-test-run --json
forge repair plan --from-last-test-run --write
```

Apply high-confidence repairs automatically. Review medium and low confidence repairs before changing code.

## 10. Final handoff

Before handing work to a human or another agent:

```bash
forge generate
forge check --json
forge verify --standard
```

For release-grade work:

```bash
forge verify --strict
```

## Agent checklist

- Start with `forge do inspect --json`.
- Read `AGENTS.md` and `agentContract.json`.
- Use dry runs before schema, policy, package, or UI changes.
- Use `forge add` and `forge deps api` before coding against provider SDKs.
- Edit source files, not `src/forge/_generated/**`.
- Regenerate after source changes.
- Use `forge check --json` before verification.
- Use repair commands when checks fail.
- Finish with `forge verify --standard` or `forge verify --strict`.

## Related pages

- [Agent Workflow](agent-workflow.md)
- [Authoring](authoring.md)
- [forge add](forge-add.md)
- [Frontend](frontend.md)
- [Testing and Repair](testing-and-repair.md)
- [Troubleshooting](troubleshooting.md)
