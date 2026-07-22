// @forge-generated generator=0.1.0-alpha.63 input=43623ccc7209d544f8745a8d03de2c1703d186ea75709a2ca79af821a88f2818 content=0a618725456d0b145dfbf8ae219ba26c7540458cca9640b798bc144040598670
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
  "plannerVersion": "0.1.0-alpha.63",
  "schemaVersion": "0.1.0"
} as const;
