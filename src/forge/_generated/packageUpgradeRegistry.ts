// @forge-generated generator=0.1.0-alpha.1 input=15db5211b2295feba64a25a14ce8d07c783b9685e9994859941a0139d6f10d5d content=36ffbb724e89de3e1876d3e93543071140c8ca220ebb04c711c50beae217b5db
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
  "plannerVersion": "0.1.0-alpha.1",
  "schemaVersion": "0.1.0"
} as const;
