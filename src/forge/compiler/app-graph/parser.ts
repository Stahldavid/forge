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

interface PriorSymbolsForFile {
  contentHash?: string;
  symbols: ForgeSymbol[];
}

function groupPriorSymbolsByFile(
  priorSymbols: ForgeSymbol[],
): Map<string, PriorSymbolsForFile> {
  const byFile = new Map<string, PriorSymbolsForFile>();
  for (const symbol of priorSymbols) {
    const existing = byFile.get(symbol.file);
    if (existing) {
      existing.symbols.push(symbol);
      continue;
    }
    const fromMeta = symbol.meta.fileContentHash;
    byFile.set(symbol.file, {
      contentHash: typeof fromMeta === "string" ? fromMeta : undefined,
      symbols: [symbol],
    });
  }
  return byFile;
}

export interface IncrementalParseResult {
  symbols: RawSymbol[];
  diagnostics: Diagnostic[];
}

export function incrementalParse(
  sources: SourceFile[],
  priorSymbols: ForgeSymbol[] | undefined,
  priorSourceHashes: Record<string, string> | undefined,
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
    : new Map<string, PriorSymbolsForFile>();

  for (const source of sources) {
    const normalizedFile = normalizePath(source.path);
    const priorForFile = priorByFile.get(normalizedFile);
    const priorHash = priorForFile?.contentHash ?? priorSourceHashes?.[normalizedFile];

    const fileUnchanged =
      !globalInvalidated &&
      priorHash === source.contentHash;

    if (fileUnchanged && priorForFile) {
      allSymbols.push(...priorSymbolsToRaw(priorForFile.symbols));
      continue;
    }
    if (fileUnchanged) {
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
