// @forge-generated generator=0.0.0 input=caf049950405a6022290d7ace56f44ae9b4892557c40e94a08bf463799a04c24 content=2a0c400033a50a9fb3a7aea8aa946f88ce62157bcba1cdab182fe319c0d41cf7
export const agentAdapterManifest = {
  "generatorVersion": "0.0.0",
  "schemaVersion": "0.1.0",
  "sourceHash": "sha256:50505230aac835604c8b13f0f4bfb7b677d20a3abc6de5c89d0e96665a08e24d",
  "targets": [
    {
      "adapterVersion": "agent-adapter-0.1.0",
      "default": true,
      "files": [
        "AGENTS.md",
        ".forge/agent/context.json",
        ".forge/agent/commands.json",
        ".forge/agent/done-criteria.json",
        ".forge/agent/playbooks/add-command.md",
        ".forge/agent/playbooks/add-query.md",
        ".forge/agent/playbooks/add-livequery.md",
        ".forge/agent/playbooks/add-resource.md",
        ".forge/agent/playbooks/refactor-field.md",
        ".forge/agent/playbooks/fix-policy-denied.md",
        ".forge/agent/playbooks/fix-guard-violation.md",
        ".forge/agent/playbooks/upgrade-package.md",
        ".forge/agent/playbooks/debug-trace.md",
        ".forge/agent/playbooks/frontend-change.md",
        ".forge/agent/playbooks/self-host-check.md"
      ],
      "formatVersion": "2026-06",
      "name": "generic"
    },
    {
      "adapterVersion": "agent-adapter-0.1.0",
      "files": [
        ".codex/skills/forge-add-command/SKILL.md",
        ".codex/skills/forge-add-resource/SKILL.md",
        ".codex/skills/forge-fix-guard-violation/SKILL.md",
        ".codex/skills/forge-fix-policy-denied/SKILL.md",
        ".codex/skills/forge-upgrade-package/SKILL.md",
        ".codex/skills/forge-debug-trace/SKILL.md",
        ".codex/agents/forge-explorer.toml",
        ".codex/agents/forge-worker.toml",
        ".codex/agents/forge-reviewer.toml",
        ".codex/agents/forge-security.toml"
      ],
      "formatVersion": "2026-06",
      "name": "codex",
      "optional": true
    },
    {
      "adapterVersion": "agent-adapter-0.1.0",
      "files": [
        ".cursor/rules/forge-runtime.mdc",
        ".cursor/rules/forge-frontend.mdc",
        ".cursor/rules/forge-security.mdc",
        ".cursor/rules/forge-workflow.mdc"
      ],
      "formatVersion": "2026-06",
      "name": "cursor",
      "optional": true
    },
    {
      "adapterVersion": "agent-adapter-0.1.0",
      "files": [
        "CLAUDE.md",
        ".claude/forge-runtime.md",
        ".claude/forge-playbooks.md",
        ".claude/forge-security.md"
      ],
      "formatVersion": "2026-06",
      "name": "claude",
      "optional": true
    }
  ]
} as const;
