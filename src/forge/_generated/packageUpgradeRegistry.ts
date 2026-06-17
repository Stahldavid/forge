// @forge-generated generator=0.1.0-alpha.8 input=68167eae1fe7969b6713da0d1448f14c78392a93426e11b48c1e1f8d08111c1b content=77d675199451304113b8adaedaf7ba07495dc65de3880dd610393423461817b6
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
  "plannerVersion": "0.1.0-alpha.8",
  "schemaVersion": "0.1.0"
} as const;
