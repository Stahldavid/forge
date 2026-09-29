// @forge-generated generator=0.1.0-alpha.67 input=2dc11ae4fcaef4dfc0d05d4b3ca83648da1b99e5202fd8001032014aaa6e9342 content=70f9b60940e57aa9e7b207153938a103db523dd295c98449f01c422773cf3688
export const agentAdapterManifest = {
  "generatorVersion": "0.1.0-alpha.67",
  "schemaVersion": "0.1.0",
  "sourceHash": "sha256:f16955ba1988f1d491d18b5dc26b29d00478c6a5382256c6c4819811574428b3",
  "targets": [
    {
      "adapterVersion": "agent-adapter-0.1.0",
      "default": true,
      "files": [
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
