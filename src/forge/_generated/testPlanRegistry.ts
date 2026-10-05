// @forge-generated generator=0.1.0-alpha.67 input=38da8c5c03d84214b14dc14a394d242e2dd8b8789e72edd7a1b94ea7d1002f19 content=daf795ae227ed96a5a48dcce1408f13d5834495e0093c48cf0a73295122054a0
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
