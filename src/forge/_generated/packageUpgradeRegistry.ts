// @forge-generated generator=0.1.0-alpha.67 input=cad72fb61cedf1a3702763e37d3d5706a149a8719284ec9090a960aa3a4e1e61 content=9c1273601034d1413165a81ea42a4297f9a99dded03c13bed1720ed16b32d40e
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
  "plannerVersion": "0.1.0-alpha.67",
  "schemaVersion": "0.1.0"
} as const;
