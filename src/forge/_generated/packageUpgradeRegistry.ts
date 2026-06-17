// @forge-generated generator=0.1.0-alpha.9 input=8272d9166eb01c344388e0da68a01dbb2259b236af7b9fe5c7605e4a01ce57fc content=82dd6d92831226669f9cabb30acf58db921c73aab1c42eadcdb82ca003231579
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
  "plannerVersion": "0.1.0-alpha.9",
  "schemaVersion": "0.1.0"
} as const;
