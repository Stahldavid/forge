// @forge-generated generator=0.1.0-alpha.64 input=5bea3de626e4a7db3a5bbe226a820619b19a6e1347922b0a4f97fedf6654c489 content=343cbb4c9aef88439260111f824008500591eb74cae7a8f68cf4cc9c22192955
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
  "plannerVersion": "0.1.0-alpha.64",
  "schemaVersion": "0.1.0"
} as const;
