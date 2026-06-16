// @forge-generated generator=0.1.0-alpha.3 input=6dc781b214af0d93cf64272aa15238cf3892cf6832c719080821b21888a3bda9 content=a8687cb760bcd247ca0c56a4bb44b04c4f1d0522471d1e82c215f2c4174bb35c
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
  "generatorVersion": "0.1.0-alpha.3",
  "planDirectory": ".forge/test-plans",
  "runDirectory": ".forge/test-runs",
  "schemaVersion": "0.1.0"
} as const;
