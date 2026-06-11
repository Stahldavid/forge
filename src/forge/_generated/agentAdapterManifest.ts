// @forge-generated generator=0.0.0 input=8e67943779820480d6e429bbc8b315f3905a1a001ce5bf71e6e562619eec6093 content=0d80f7a8bf3c1cb527af934b3d2838ec3cdfacca054789a00f7afec24089be74
export const agentAdapterManifest = {
  "generatorVersion": "0.0.0",
  "schemaVersion": "0.1.0",
  "sourceHash": "sha256:87cf17bf53676f678d24c9eaf17bd595c915fb02e071749d25de22d997ff1376",
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
