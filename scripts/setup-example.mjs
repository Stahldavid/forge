import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const exampleRoot = join(repoRoot, "examples", "basic-forge-app");
const fixturePackages = join(repoRoot, "tests", "fixtures", "packages");
const nodeModules = join(exampleRoot, "node_modules");

if (!existsSync(exampleRoot)) {
  console.error(`missing example directory: ${exampleRoot}`);
  process.exit(1);
}

mkdirSync(nodeModules, { recursive: true });
for (const entry of readdirSync(fixturePackages, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const destination = join(nodeModules, entry.name);
  rmSync(destination, { recursive: true, force: true });
  cpSync(join(fixturePackages, entry.name), destination, {
    recursive: true,
    force: true,
  });
}

console.log(`seeded ${nodeModules} from ${fixturePackages}`);
