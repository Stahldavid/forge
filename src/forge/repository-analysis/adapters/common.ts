import { hashRepositoryFile, sourceLocation } from "../scanner.ts";
import { REPOSITORY_ANALYZER_VERSION } from "../types.ts";
import type { AdapterResult, AnalysisSource, RepositoryEdge, RepositoryEvidence, RepositoryNode } from "../types.ts";

export function nodeId(kind: string, file: string, name: string): string {
  return `${kind}:${hashRepositoryFile(`${file}\0${name}`).slice(0, 24)}`;
}

export function evidence(source: AnalysisSource, assurance: RepositoryEvidence["assurance"] = "syntactic", resolution: RepositoryEvidence["resolution"] = "partial"): RepositoryEvidence {
  return { assurance, resolution, adapter: source.adapter, version: REPOSITORY_ANALYZER_VERSION, sourceHash: source.hash };
}

export function makeNode(source: AnalysisSource, kind: string, name: string, start = 0, end = start, metadata: Record<string, unknown> = {}, qualifier = name): RepositoryNode {
  return { id: nodeId(kind, source.path, qualifier), kind, name, file: source.path, component: source.component, location: sourceLocation(source.text, start, end), evidence: evidence(source), metadata };
}

export function makeEdge(from: RepositoryNode | string, to: RepositoryNode | string, kind: string, proof: RepositoryEvidence, metadata: Record<string, unknown> = {}): RepositoryEdge {
  const a = typeof from === "string" ? from : from.id;
  const b = typeof to === "string" ? to : to.id;
  return { id: nodeId("edge", a, `${kind}\0${b}\0${JSON.stringify(metadata)}`), from: a, to: b, kind, evidence: proof, metadata };
}

export function emptyResult(): AdapterResult {
  return { nodes: [], edges: [], diagnostics: [], limitations: [] };
}

/** Drop comments while preserving UTF-16 offsets. Literals are retained for annotations. */
export function maskComments(text: string): string {
  let output = "";
  let i = 0;
  while (i < text.length) {
    const character = text[i];
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      output += character; i++;
      while (i < text.length) {
        output += text[i];
        if (text[i] === "\\" && i + 1 < text.length) { output += text[i + 1]; i += 2; continue; }
        if (text[i++] === quote) break;
      }
    } else if (text.slice(i, i + 2) === "//") {
      while (i < text.length && text[i] !== "\n") { output += " "; i++; }
    } else if (text.slice(i, i + 2) === "/*") {
      output += "  "; i += 2;
      while (i < text.length && text.slice(i, i + 2) !== "*/") { output += text[i] === "\n" || text[i] === "\r" ? text[i] : " "; i++; }
      if (i < text.length) { output += "  "; i += 2; }
    } else { output += character; i++; }
  }
  return output;
}

export function maskLiterals(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gs, (value) => value.replace(/[^\r\n]/g, " "));
}

export function staticHttpPath(value: string): string | undefined {
  if (/\$\{|\{\{|\s/.test(value)) return undefined;
  try {
    const url = new URL(value, "http://repository.invalid");
    return url.pathname;
  } catch { return undefined; }
}

export function httpPathPattern(value: string): string {
  return value.replace(/\{[^}]+\}|:[^/]+/g, "*").replace(/\/$/, "") || "/";
}

export function httpPathMatches(pattern: string, requestPath: string): boolean {
  const expected = httpPathPattern(pattern).split("/");
  const actual = httpPathPattern(requestPath).split("/");
  return expected.length === actual.length && expected.every((segment, index) => segment === actual[index] || segment === "*" && !!actual[index]);
}
