import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outputDir = process.argv[2] ?? "security/evidence/latest";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const createPkg = JSON.parse(readFileSync("packages/create-forge-app/package.json", "utf8"));
mkdirSync(outputDir, { recursive: true });

function componentsFromDependencies(packageJson) {
  const components = [];
  for (const [scope, dependencies] of [
    ["required", packageJson.dependencies ?? {}],
    ["optional", packageJson.devDependencies ?? {}],
  ]) {
    for (const [name, version] of Object.entries(dependencies)) {
      components.push({
        type: "library",
        name,
        version,
        scope,
        purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(String(version))}`,
      });
    }
  }
  return components.sort((left, right) => `${left.scope}:${left.name}`.localeCompare(`${right.scope}:${right.name}`));
}

const releaseEvidence = {
  schemaVersion: "0.1.0",
  kind: "release-supply-chain-evidence",
  package: {
    name: pkg.name,
    version: pkg.version,
    distTag: pkg.publishConfig?.tag ?? "latest",
    provenanceRequested: true,
    access: pkg.publishConfig?.access ?? "restricted",
  },
  createPackage: {
    name: createPkg.name,
    version: createPkg.version,
    distTag: createPkg.publishConfig?.tag ?? "latest",
  },
  source: {
    repository: pkg.repository?.url ?? null,
    commit: process.env.GITHUB_SHA ?? "local",
    ref: process.env.GITHUB_REF_NAME ?? "local",
  },
  gates: [
    "npm run typecheck",
    "npm run forge -- generate",
    "npm run forge -- rls test --db postgres --json",
    "npm run forge -- rls mutate-test --json",
    "npm run forge -- security prove --db postgres --full --json",
    "npm test",
    "npm run release:smoke",
    "npm run release:verify-public-alpha",
  ],
};

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  serialNumber: `urn:uuid:${pkg.name}-${pkg.version}`.replace(/[^a-zA-Z0-9:._-]/g, "-"),
  version: 1,
  metadata: {
    component: {
      type: "application",
      name: pkg.name,
      version: pkg.version,
    },
  },
  components: componentsFromDependencies(pkg),
};

writeFileSync(
  join(outputDir, "release-supply-chain.json"),
  `${JSON.stringify(releaseEvidence, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  join(outputDir, "sbom.cyclonedx.json"),
  `${JSON.stringify(bom, null, 2)}\n`,
  "utf8",
);

console.log(`wrote release evidence and SBOM to ${outputDir}`);
