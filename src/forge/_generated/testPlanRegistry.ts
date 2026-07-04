// @forge-generated generator=0.1.0-alpha.61 input=3e83e39b92f8a1e2337d18ed7565f99b151980139cd5104f0b7f462eedfed3b9 content=98b0ba9258a35836d29f50ccbfa0d7b4835465d6282b4a7573e4f799a9de50eb
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
  "generatorVersion": "0.1.0-alpha.61",
  "planDirectory": ".forge/test-plans",
  "runDirectory": ".forge/test-runs",
  "schemaVersion": "0.1.0"
} as const;
