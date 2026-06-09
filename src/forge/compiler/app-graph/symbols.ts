import { deriveStableSymbolId, hashStable } from "../primitives/hash.ts";
import type { ForgeSymbol } from "../types/app-graph.ts";
import type { SourceFile } from "../types/app-graph.ts";
import type { RawSymbol } from "./types.ts";

export function rawToForgeSymbol(
  raw: RawSymbol,
  fileContentHash: string,
): ForgeSymbol {
  const id = deriveStableSymbolId({
    kind: raw.kind,
    canonicalModulePath: raw.file,
    qualifiedName: raw.qualifiedName,
    exportPath: raw.exportPath,
  });

  const slice = raw.sourceSlice || "";
  const contentHash = slice.length > 0 ? hashStable(slice) : fileContentHash;

  return {
    id,
    kind: raw.kind,
    name: raw.name,
    qualifiedName: raw.qualifiedName,
    file: raw.file,
    span: raw.span,
    contentHash,
    meta: {
      exportPath: raw.exportPath,
      fileContentHash,
      ...(slice.length > 0 ? { sourceSlice: slice } : {}),
    },
  };
}

export function buildForgeSymbols(
  rawSymbols: RawSymbol[],
  sources: SourceFile[],
): ForgeSymbol[] {
  const hashByFile = new Map<string, string>();
  for (const source of sources) {
    hashByFile.set(source.path, source.contentHash);
  }

  return rawSymbols.map((raw) =>
    rawToForgeSymbol(raw, hashByFile.get(raw.file) ?? ""),
  );
}
