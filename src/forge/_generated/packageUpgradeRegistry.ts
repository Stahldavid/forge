// @forge-generated generator=0.1.0-alpha.68 input=eb85ce79777e8854119a312edd29262099578bdd5f8be82c03b5f0caae80f391 content=65c1de722a2422f96c6ec9ef30f9f66004c2cc599521b2c0d5c90e6752bd4a5c
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
  "plannerVersion": "0.1.0-alpha.68",
  "schemaVersion": "0.1.0"
} as const;
