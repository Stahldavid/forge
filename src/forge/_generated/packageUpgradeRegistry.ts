// @forge-generated generator=0.1.0-alpha.29 input=b7e3d13ed54a83a393e821d2a309404ee70f774794cda86187334aab958f539c content=46c54d93ef6723fea6d0179bbb27c99e2c9ee5ea81b73c22ab051158d86030e8
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
  "plannerVersion": "0.1.0-alpha.29",
  "schemaVersion": "0.1.0"
} as const;
