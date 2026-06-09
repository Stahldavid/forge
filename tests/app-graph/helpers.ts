import { readFileSync } from "node:fs";
import path from "node:path";
import { hashStable } from "../../src/forge/compiler/primitives/hash.ts";
import { normalizePath } from "../../src/forge/compiler/primitives/paths.ts";
import type { SourceFile } from "../../src/forge/compiler/types/app-graph.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "fixtures");

export function fixtureSource(name: string): SourceFile {
  const absolute = path.join(FIXTURES_DIR, name);
  const text = readFileSync(absolute, "utf8");
  const relative = normalizePath(path.join("tests/app-graph/fixtures", name));
  return {
    path: relative,
    text,
    contentHash: hashStable(text),
  };
}

export function fixtureWorkspaceRoot(): string {
  return path.resolve(import.meta.dir, "../..").replace(/\\/g, "/");
}
