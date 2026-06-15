// @forge-generated generator=0.1.0-alpha.0 input=663bd72fd297303ae67eb0c0c2217d62f2812ed9bd19c3b7f91de866277d7c97 content=6aa2cc828b0121cc0f5b4abf89033b88220c38d7e5bf341bf01f18333ba7bc12
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
  "plannerVersion": "0.1.0-alpha.0",
  "schemaVersion": "0.1.0"
} as const;
