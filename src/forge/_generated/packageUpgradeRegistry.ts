// @forge-generated generator=0.1.0-alpha.2 input=f450ec7161e279f2460d497d4129943c5786d075c3be87365a6f1f0ab77a3fcd content=9ec83f9190a1d0b61cfd3c2d4d4e0981a4a1d4ae55c7c1137e6f02632021f0d0
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
  "plannerVersion": "0.1.0-alpha.2",
  "schemaVersion": "0.1.0"
} as const;
