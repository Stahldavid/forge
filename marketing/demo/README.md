# ForgeOS Demo Assets

This folder contains reproducible generators for ForgeOS launch/demo assets.

The primary demo is the ForgeOS Agent Workroom: a browser-recorded product walkthrough for the external-agent workflow. It includes a live app preview like modern AI app builders, but it does not pretend that the browser runs Codex, Claude Code, or Cursor. The user opens the chosen external coding agent in the project directory, while ForgeOS shows the preview, context, hook signals, timeline, changed-file focus, checks, and handoff evidence that make the agent safe to use.

## Generate with Playwright CLI

Use this version for the README hero, GitHub issue/PR announcements, X/LinkedIn posts, and launch pages. The MP4 is the main asset for distribution; the GIF is a lighter preview for places where video embedding is awkward.

Requirements:

- `playwright-cli`
- `ffmpeg`
- `python`

```powershell
powershell -ExecutionPolicy Bypass -File marketing/demo/record-playwright-demo.ps1
```

Outputs:

```text
marketing/demo/assets/forgeos-demo-playwright.gif
marketing/demo/assets/forgeos-demo-playwright.mp4
marketing/demo/assets/forgeos-demo-playwright.webm
```

Current shape:

```text
Duration: about 67 seconds
MP4: 1280x720, 25fps
GIF preview: 800x450, 8fps
```

## Generate the lightweight fallback

```bash
python marketing/demo/generate-demo-assets.py
```

Outputs:

```text
marketing/demo/assets/forgeos-demo-short.gif
marketing/demo/assets/forgeos-demo-short.mp4
```


## Message

```text
External coding agents can build ForgeOS apps with context, memory, and verification.
ForgeOS keeps the work legible in git.
```

The primary demo focuses on the agent-native development loop:

```bash
forge status --json
forge changed --json
forge agent onboard --target codex --json
forge agent context --current --json
forge test plan --changed --json
forge verify --standard
forge handoff --json
```
