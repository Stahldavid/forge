// @forge-generated generator=0.1.0-alpha.39 input=f8919744f953e216381deb3344bfadd99210164d5b86a1ecfa27c2e44825c874 content=b169445d49db00e59fab3e6c23cb77ac7759dbdb7184c3311aa1e89b18aca89c
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
  "plannerVersion": "0.1.0-alpha.39",
  "schemaVersion": "0.1.0"
} as const;
