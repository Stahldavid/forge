// @forge-generated generator=0.1.0-alpha.0 input=4dbda59592f3ea3b2e8992aa95fec54fd7f948fb5fcacf9a05a77ed0f3792761 content=6aa2cc828b0121cc0f5b4abf89033b88220c38d7e5bf341bf01f18333ba7bc12
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
