// @forge-generated generator=0.1.0-alpha.65 input=dbf2c962fa9cf8e2fa9dc988c6cf3a4e462e8f7dd759f143418b9538a08f4a85 content=7982e92a4427031867a766294c34a834a734387bea5e2d481e1afb18aafdea33
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
  "plannerVersion": "0.1.0-alpha.65",
  "schemaVersion": "0.1.0"
} as const;
