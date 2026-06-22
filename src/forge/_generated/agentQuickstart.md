// @forge-generated generator=0.1.0-alpha.18 input=708af382008551e1ec0972158bf7ba0ad9cb4c4c4a7356fc75bbc51cd0719fa5 content=ba4328fa924005a8a6e04619b77df8b167cff33042faa489e66bab989b17e87a
# Agent Quickstart

Run:

```bash
forge agent onboard --target codex --json
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge agent print-context --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge inspect all --json
forge check --json
forge ai trace <traceId> --json
```

Never edit:

```txt
src/forge/_generated/**
forge.lock
```

If generated files are ignored by git, recreate them with `forge generate`.

Always finish with:

```bash
forge generate
forge verify framework
```
