// @forge-generated generator=0.0.0 input=5218512cdec2311e17d4b1dc480d6a6452a6574b5cef32195bb11218ee04b842 content=b3f4ce6761fa27294f33efcc96ea5b9a36a1acaebcc34bede673134ca6cb482c
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
  "plannerVersion": "0.0.0",
  "schemaVersion": "0.1.0"
} as const;
