// @forge-generated generator=0.1.0-alpha.25 input=93e9f4f72ca6f1bde1a9ff909c546319cbcfd3965c2a9f4099c06e0c81dbab7a content=0c38574758bf4401d0769bfd5ce456759d44e566ca1c0a0efb6a19b2c238bdf2
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
  "plannerVersion": "0.1.0-alpha.25",
  "schemaVersion": "0.1.0"
} as const;
