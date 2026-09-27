// @forge-generated generator=0.1.0-alpha.63 input=62246762620888d4eb3bd4233fe8c61c4adcead4d706dd12016618e6604e0aeb content=0a618725456d0b145dfbf8ae219ba26c7540458cca9640b798bc144040598670
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
