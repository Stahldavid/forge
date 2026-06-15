// @forge-generated generator=0.1.0-alpha.0 input=3e73eacf20870a5978a8aeb9088112fa211eecaef5a80a7e51b92cbd8b40cd8d content=6aa2cc828b0121cc0f5b4abf89033b88220c38d7e5bf341bf01f18333ba7bc12
export const packageUpgradeRegistry = {
  "commands": [
    "forge deps outdated --json",
    "forge deps inspect <package> --json",
    "forge deps diff <package> --to latest --json",
    "forge deps upgrade-plan <package> --to latest",
    "forge deps upgrade-apply <plan>",
    "forge deps upgrade-check --json",
    "forge deps upgrade-rollback <planId>"
  ],
  "planDirectory": ".forge/upgrades",
  "plannerVersion": "0.1.0-alpha.0",
  "schemaVersion": "0.1.0"
} as const;
