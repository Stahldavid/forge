// @forge-generated generator=0.1.0-alpha.18 input=1c1ef7efb2ac73b43268abb18f6939fcb29db9810b977fe6c343d7c6b2bb8b0b content=a2e23d6a49f7a3c1da5a570bb84f82c284ebb15a91b682523f74ef97a466c41a
export const agentAdapterManifest = {
  "generatorVersion": "0.1.0-alpha.18",
  "schemaVersion": "0.1.0",
  "sourceHash": "sha256:0d9f5722da28ca3438d5569405126576bf2a06e683253ab8254a543e9230c2a0",
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
