// @forge-generated generator=0.1.0-alpha.3 input=0ece0560c9d3676ff4363aaf8d954bb17be20b06abcc4e0e01c2e2bd0e69e106 content=3e9f1d252bceb93d698a23b0cc3adb89fc2603f0345297b00ac056cd59fe2611
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
  "plannerVersion": "0.1.0-alpha.3",
  "schemaVersion": "0.1.0"
} as const;
