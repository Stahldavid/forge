// @forge-generated generator=0.1.0-alpha.0 input=2bec5acb1fae59bf9d55eca4937af5b76424e610905e4ef337a33d3f7ec220d2 content=6cf243a2b4690ae99b6db28000c6af77f0b1ac531f826460a2f8638999bb862b
export const agentAdapterManifest = {
  "generatorVersion": "0.1.0-alpha.0",
  "schemaVersion": "0.1.0",
  "sourceHash": "sha256:a54f86431815ecdcee93272f791a0c294c4b77d855a2e880138ab3423c701051",
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
