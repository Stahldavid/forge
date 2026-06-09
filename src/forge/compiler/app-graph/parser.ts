import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import { createDiagnostic } from "../diagnostics/create.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { ForgeSymbol, SourceFile } from "../types/app-graph.ts";
import { normalizePath } from "../primitives/paths.ts";
import { extractSymbolsFromTree } from "./extract.ts";
import type { ParseInvalidationKey, RawSymbol } from "./types.ts";
import { parseInvalidationKeyEquals } from "./types.ts";

const tsParser = new Parser();
tsParser.setLanguage(TypeScript.typescript as unknown as Parser.Language);

const tsxParser = new Parser();
tsxParser.setLanguage(TypeScript.tsx as unknown as Parser.Language);

function parserForFile(path: string): Parser {
  return path.endsWith(".tsx") ? tsxParser : tsParser;
}

function priorSymbolsToRaw(symbols: ForgeSymbol[]): RawSymbol[] {
  return symbols.map((symbol) => ({
    kind: symbol.kind,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    file: symbol.file,
    span: symbol.span,
    exportPath:
      typeof symbol.meta.exportPath === "string" ? symbol.meta.exportPath : "",
    sourceSlice:
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "",
  }));
}

function groupPriorSymbolsByFile(
  priorSymbols: ForgeSymbol[],
): Map<string, ForgeSymbol[]> {
  const byFile = new Map<string, ForgeSymbol[]>();
  for (const symbol of priorSymbols) {
    const list = byFile.get(symbol.file) ?? [];
    list.push(symbol);
    byFile.set(symbol.file, list);
  }
  return byFile;
}

function priorFileContentHash(
  priorSymbols: ForgeSymbol[],
  file: string,
): string | undefined {
  const match = priorSymbols.find((symbol) => symbol.file === file);
  if (!match) {
    return undefined;
  }
  // All symbols from the same file share the same slice hash basis; use meta when present.
  const fromMeta = match.meta.fileContentHash;
  return typeof fromMeta === "string" ? fromMeta : undefined;
}

export interface IncrementalParseResult {
  symbols: RawSymbol[];
  diagnostics: Diagnostic[];
}

export function incrementalParse(
  sources: SourceFile[],
  priorSymbols: ForgeSymbol[] | undefined,
  priorInvalidation: ParseInvalidationKey | undefined,
  currentInvalidation: ParseInvalidationKey,
): IncrementalParseResult {
  const diagnostics: Diagnostic[] = [];
  const allSymbols: RawSymbol[] = [];
  const globalInvalidated =
    priorInvalidation === undefined ||
    !parseInvalidationKeyEquals(priorInvalidation, currentInvalidation);

  const priorByFile = priorSymbols
    ? groupPriorSymbolsByFile(priorSymbols)
    : new Map<string, ForgeSymbol[]>();

  for (const source of sources) {
    const normalizedFile = normalizePath(source.path);
    const priorForFile = priorByFile.get(normalizedFile);
    const priorHash = priorSymbols
      ? priorFileContentHash(priorSymbols, normalizedFile)
      : undefined;

    const fileUnchanged =
      !globalInvalidated &&
      priorForFile !== undefined &&
      priorHash === source.contentHash;

    if (fileUnchanged) {
      allSymbols.push(...priorSymbolsToRaw(priorForFile));
      continue;
    }

    try {
      const tree = parserForFile(normalizedFile).parse(source.text);
      const extracted = extractSymbolsFromTree(
        tree.rootNode,
        normalizedFile,
        source.text,
      );
      allSymbols.push(...extracted);
    } catch {
      diagnostics.push(
        createDiagnostic({
          severity: "warning",
          code: "FORGE_UNPARSEABLE_FILE",
          message: `cannot parse source file: ${normalizedFile}`,
          file: normalizedFile,
        }),
      );
    }
  }

  return { symbols: allSymbols, diagnostics };
}
