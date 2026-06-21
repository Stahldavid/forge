# __FORGE_APP_TITLE__

An agent-native ForgeOS workroom. It is not a chat app. Codex, Claude Code, or
Cursor work in this directory, while the UI shows the app preview, terminal-like
agent signals, generated freshness, diff focus, checks, and handoff evidence
collected by ForgeOS.

## Run

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run dev
```

The workroom runs on the Forge web port. The app being built should normally run
on the next port, for example `http://127.0.0.1:5174`.

## Attach to Studio

```bash
forge studio attach . --target codex --preview-port 5174
forge agent doctor --target codex
```

Agent hooks can feed the room through ForgeOS commands or `forge agent ingest`.

The browser does not chat with an AI model. It observes:

- the app preview, usually on `http://127.0.0.1:5174`;
- hook or ingest events from the external code agent;
- authored-vs-generated diff focus;
- generated artifact state (`fresh`, `regenerated`, or `stale-risk`);
- verification evidence from `forge check` / `forge verify agent`.
