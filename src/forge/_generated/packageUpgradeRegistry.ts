// @forge-generated generator=0.1.0-alpha.40 input=e7e1c05d24f59dda0a9ffa9173a1bc3b6972f9ad1617c90975da4cd24651ab46 content=e6429072140cdf82c866ed9a4a485fdf7a26fd8bab767a75fe6bafa684becf5a
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
  "plannerVersion": "0.1.0-alpha.40",
  "schemaVersion": "0.1.0"
} as const;
