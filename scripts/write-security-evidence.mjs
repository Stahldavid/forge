import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const inputPath = process.argv[2] ?? "security/evidence/latest/security-proof.json";
const outputDir = process.argv[3] ?? "security/evidence/latest";

function readProof(path) {
  const raw = readFileSync(path, "utf8");
  const parsed = parseSecurityProof(raw, path);
  if (parsed.kind !== "security-proof") {
    throw new Error(`${path} is not a ForgeOS security proof`);
  }
  return parsed;
}

function parseSecurityProof(raw, path) {
  try {
    return JSON.parse(raw);
  } catch {
    const extracted = extractJsonObjects(raw)
      .map((candidate) => {
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      })
      .find((candidate) => candidate?.kind === "security-proof");

    if (extracted) {
      return extracted;
    }
    throw new Error(`${path} does not contain a valid ForgeOS security proof JSON object`);
  }
}

function extractJsonObjects(raw) {
  const objects = [];
  for (let start = raw.indexOf("{"); start !== -1; start = raw.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < raw.length; index++) {
      const char = raw[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) {
        continue;
      }
      if (char === "{") {
        depth += 1;
      }
      if (char === "}") {
        depth -= 1;
      }
      if (depth === 0) {
        objects.push(raw.slice(start, index + 1));
        break;
      }
    }
  }
  return objects;
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
