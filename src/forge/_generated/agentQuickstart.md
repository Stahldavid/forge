// @forge-generated generator=0.1.0-alpha.30 input=126f7f78b3bd4495b73c6a82f3fc9d5661b8040ee4a43d68eef6b59fc7e33d57 content=66f694c6d1f17562f52023a8aca0bb7ed88783bb1f249525132cdf6e7c4a1698
# Agent Quickstart

Run:

```bash
node bin/forge.mjs agent onboard --target codex --json
node bin/forge.mjs status --json
node bin/forge.mjs changed --json
node bin/forge.mjs handoff --json
node bin/forge.mjs do inspect --json
node bin/forge.mjs do fix --json
node bin/forge.mjs do verify --json
node bin/forge.mjs dev --once --json
node bin/forge.mjs dev
node bin/forge.mjs agent print-context --json
node bin/forge.mjs inspect frontend --json
node bin/forge.mjs inspect capabilities --json
node bin/forge.mjs inspect agent-tools --json
node bin/forge.mjs inspect all --json
node bin/forge.mjs check --json
node bin/forge.mjs ai trace <traceId> --json
```

Never edit:

```txt
src/forge/_generated/**
forge.lock
```

If generated files are ignored by git, recreate them with `node bin/forge.mjs generate`.

Always finish with:

```bash
node bin/forge.mjs generate
node bin/forge.mjs verify framework
```
