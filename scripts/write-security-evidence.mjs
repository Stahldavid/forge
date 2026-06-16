import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const inputPath = process.argv[2] ?? "security/evidence/latest/security-proof.json";
const outputDir = process.argv[3] ?? "security/evidence/latest";

function readProof(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw);
  if (parsed.kind !== "security-proof") {
    throw new Error(`${path} is not a ForgeOS security proof`);
  }
  return parsed;
}

function artifactName(value) {
  return `${String(value).replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}.json`;
}

const proof = readProof(inputPath);
const invariants = proof.evidence?.invariants ?? [];
mkdirSync(outputDir, { recursive: true });

for (const invariant of invariants) {
  const output = {
    schemaVersion: "0.1.0",
    kind: "security-invariant-evidence",
    source: basename(inputPath),
    commit: process.env.GITHUB_SHA ?? "local",
    assurance: proof.assurance,
    invariant,
    proofSummary: proof.summary,
  };
  writeFileSync(
    join(outputDir, artifactName(invariant.artifact)),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8",
  );
}

console.log(`wrote ${invariants.length} security evidence artifact(s) to ${outputDir}`);
