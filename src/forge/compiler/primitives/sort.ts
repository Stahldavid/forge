import type { ForgeEdge, ForgeSymbol } from "../types/app-graph.ts";
import type { EmitFile } from "../types/emit.ts";
import type {
  Entrypoint,
  ExportSignature,
  PackageApi,
} from "../types/package-graph.ts";
import { compareBytes } from "./compare.ts";
import { comparePaths } from "./paths.ts";

function stableSortInPlace<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  items.sort(compare);
  return items;
}

export function compareSymbols(a: ForgeSymbol, b: ForgeSymbol): number {
  let cmp = compareBytes(a.kind, b.kind);
  if (cmp !== 0) return cmp;

  cmp = compareBytes(a.name, b.name);
  if (cmp !== 0) return cmp;

  cmp = comparePaths(a.file, b.file);
  if (cmp !== 0) return cmp;

  return a.span.start - b.span.start;
}

export function compareEdges(a: ForgeEdge, b: ForgeEdge): number {
  let cmp = compareBytes(a.from, b.from);
  if (cmp !== 0) return cmp;

  cmp = compareBytes(a.to, b.to);
  if (cmp !== 0) return cmp;

  return compareBytes(a.kind, b.kind);
}

export function comparePackages(a: PackageApi, b: PackageApi): number {
  return compareBytes(a.name, b.name);
}

export function compareEntrypoints(a: Entrypoint, b: Entrypoint): number {
  return compareBytes(a.subpath, b.subpath);
}

export function compareExports(a: ExportSignature, b: ExportSignature): number {
  return compareBytes(a.name, b.name);
}

export function compareEmitFiles(a: EmitFile, b: EmitFile): number {
  return comparePaths(a.path, b.path);
}

export function stableSortSymbols(symbols: ForgeSymbol[]): ForgeSymbol[] {
  return stableSortInPlace([...symbols], compareSymbols);
}

export function stableSortEdges(edges: ForgeEdge[]): ForgeEdge[] {
  return stableSortInPlace([...edges], compareEdges);
}

export function stableSortPackages(packages: PackageApi[]): PackageApi[] {
  return stableSortInPlace([...packages], comparePackages);
}

export function stableSortEntrypoints(
  entrypoints: Entrypoint[],
): Entrypoint[] {
  return stableSortInPlace([...entrypoints], compareEntrypoints);
}

export function stableSortExports(exports: ExportSignature[]): ExportSignature[] {
  return stableSortInPlace([...exports], compareExports);
}

export function stableSortEmitFiles(files: EmitFile[]): EmitFile[] {
  return stableSortInPlace([...files], compareEmitFiles);
}

export function stableSortStrings(items: string[]): string[] {
  return stableSortInPlace([...items], compareBytes);
}

export function stableSortByPath(items: string[]): string[] {
  return stableSortInPlace([...items], comparePaths);
}
