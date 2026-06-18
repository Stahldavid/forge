// @forge-generated generator=0.1.0-alpha.10 input=17d4dad0c0c44729ad234dea95690f1a993d0142a54695c77ac4008c415c73d5 content=301b625bafb30627ba6ea9becc94d6ecfdf4b423401cc8efed58623c963c2cdb
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
  "generatorVersion": "0.1.0-alpha.10",
  "planDirectory": ".forge/test-plans",
  "runDirectory": ".forge/test-runs",
  "schemaVersion": "0.1.0"
} as const;
