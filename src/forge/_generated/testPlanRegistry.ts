// @forge-generated generator=0.1.0-alpha.67 input=2dc11ae4fcaef4dfc0d05d4b3ca83648da1b99e5202fd8001032014aaa6e9342 content=daf795ae227ed96a5a48dcce1408f13d5834495e0093c48cf0a73295122054a0
export const testPlanRegistry = {
  "commands": [
    "forge impact --changed --json",
    "forge test plan --changed --json",
    "forge test run --changed --json",
    "forge test run --changed --timeout-ms <ms> --json",
    "forge test explain <testFile> --json",
    "forge verify --changed",
    "forge verify --fast",
    "forge verify --smoke",
    "forge verify --standard",
    "forge verify --strict"
  ],
  "costs": [
    "instant",
    "fast",
    "standard",
    "slow",
    "docker",
    "browser"
  ],
  "generatedArtifacts": [
    "src/forge/_generated/testGraph.json",
    "src/forge/_generated/testGraph.ts",
    "src/forge/_generated/testPlanRegistry.json",
    "src/forge/_generated/testPlanRegistry.ts"
  ],
  "generatorVersion": "0.1.0-alpha.67",
  "planDirectory": ".forge/test-plans",
  "runDirectory": ".forge/test-runs",
  "schemaVersion": "0.1.0"
} as const;
