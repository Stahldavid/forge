import { existsSync, readFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { FORGE_SOURCEMAP_SYMBOLICATION_FAILED } from "../../compiler/diagnostics/codes.ts";
import type {
  SourceMapManifest,
  StacktraceInput,
  SymbolicatedFrame,
  SymbolicationResult,
} from "../../compiler/release/types.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function decodeVlq(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const char of segment) {
    const integer = BASE64.indexOf(char);
    if (integer < 0) {
      continue;
    }
    const continuation = integer & 32;
    const digit = integer & 31;
    value += digit << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = value & 1;
    values.push((value >> 1) * (negative ? -1 : 1));
    value = 0;
    shift = 0;
  }
  return values;
}

interface Mapping {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
  nameIndex?: number;
}

interface SourceMapV3 {
  version: number;
  file?: string;
  sources: string[];
  names?: string[];
  mappings: string;
}

function parseMappings(map: SourceMapV3): Mapping[] {
  const mappings: Mapping[] = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let nameIndex = 0;

  const lines = map.mappings.split(";");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let generatedColumn = 0;
    const segments = lines[lineIndex]?.split(",").filter(Boolean) ?? [];
    for (const segment of segments) {
      const values = decodeVlq(segment);
      if (values.length < 4) {
        continue;
      }
      generatedColumn += values[0] ?? 0;
      sourceIndex += values[1] ?? 0;
      originalLine += values[2] ?? 0;
      originalColumn += values[3] ?? 0;
      if (values.length >= 5) {
        nameIndex += values[4] ?? 0;
      }
      mappings.push({
        generatedLine: lineIndex + 1,
        generatedColumn,
        sourceIndex,
        originalLine: originalLine + 1,
        originalColumn,
        ...(values.length >= 5 ? { nameIndex } : {}),
      });
    }
  }
  return mappings;
}

function basenamePath(path: string): string {
  return normalize(path).replace(/\\/g, "/").split("/").pop() ?? path;
}

function findSourceMap(
  workspaceRoot: string,
  manifest: SourceMapManifest,
  file: string,
): string | null {
  const normalizedFile = file.replace(/\\/g, "/");
  const match = manifest.sourceMaps.find(
    (entry) =>
      entry.generatedFile === normalizedFile ||
      entry.generatedFile.endsWith(normalizedFile) ||
      basenamePath(entry.generatedFile) === basenamePath(normalizedFile),
  );
  if (!match) {
    return null;
  }
  const absolute = join(workspaceRoot, match.sourceMapFile);
  return existsSync(absolute) ? absolute : null;
}

function symbolicateFrame(map: SourceMapV3, frame: { line: number; column: number }): SymbolicatedFrame["original"] {
  const mappings = parseMappings(map)
    .filter((mapping) => mapping.generatedLine === frame.line)
    .sort((a, b) => a.generatedColumn - b.generatedColumn);
  const candidate =
    mappings.filter((mapping) => mapping.generatedColumn <= frame.column).at(-1) ??
    mappings[0];
  if (!candidate) {
    return undefined;
  }
  return {
    source: map.sources[candidate.sourceIndex] ?? "unknown",
    line: candidate.originalLine,
    column: candidate.originalColumn,
    ...(candidate.nameIndex !== undefined && map.names?.[candidate.nameIndex]
      ? { name: map.names[candidate.nameIndex] }
      : {}),
  };
}

export function symbolicateStacktrace(input: {
  workspaceRoot: string;
  manifest: SourceMapManifest;
  stacktrace: StacktraceInput;
}): SymbolicationResult {
  const frames: SymbolicatedFrame[] = [];
  const diagnostics = [];

  for (const frame of input.stacktrace.frames) {
    const sourceMapPath = findSourceMap(input.workspaceRoot, input.manifest, frame.file);
    if (!sourceMapPath) {
      frames.push({ generated: frame });
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_SOURCEMAP_SYMBOLICATION_FAILED,
          message: `no source map found for ${frame.file}`,
        }),
      );
      continue;
    }

    try {
      const map = JSON.parse(readFileSync(sourceMapPath, "utf8")) as SourceMapV3;
      frames.push({
        generated: frame,
        original: symbolicateFrame(map, frame),
      });
    } catch (error) {
      frames.push({ generated: frame });
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: FORGE_SOURCEMAP_SYMBOLICATION_FAILED,
          message: error instanceof Error ? error.message : "source map parse failed",
        }),
      );
    }
  }

  return { frames, diagnostics };
}
