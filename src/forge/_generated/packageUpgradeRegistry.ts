// @forge-generated generator=0.1.0-alpha.30 input=126f7f78b3bd4495b73c6a82f3fc9d5661b8040ee4a43d68eef6b59fc7e33d57 content=71267418f842878057af1412b3067a76258f261f51ec884c57148c8075bab9ca
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
  "plannerVersion": "0.1.0-alpha.30",
  "schemaVersion": "0.1.0"
} as const;
