// @forge-generated generator=0.1.0-alpha.18 input=708af382008551e1ec0972158bf7ba0ad9cb4c4c4a7356fc75bbc51cd0719fa5 content=2f3961b9c5b0bfe5a7d8cccfb8186714fdd29e66ad8ec56c00767e28b5171fe8
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
  "plannerVersion": "0.1.0-alpha.18",
  "schemaVersion": "0.1.0"
} as const;
