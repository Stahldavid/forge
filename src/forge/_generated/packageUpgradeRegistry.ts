// @forge-generated generator=0.1.0-alpha.10 input=17d4dad0c0c44729ad234dea95690f1a993d0142a54695c77ac4008c415c73d5 content=14338326d3c9ba6a91bb0d7df0c21fb8b4fd67aef6839e56481964079b90a0eb
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
  "plannerVersion": "0.1.0-alpha.10",
  "schemaVersion": "0.1.0"
} as const;
