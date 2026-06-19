// @forge-generated generator=0.1.0-alpha.17 input=e751b452338c88a7e9e015c5a6bcc9dfb7a7a36386e730af0ddf5e86dca23232 content=d38df46032e6b0be9b4aba635eb79cb8281f42621f308869de03d601e6279065
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
  "plannerVersion": "0.1.0-alpha.17",
  "schemaVersion": "0.1.0"
} as const;
