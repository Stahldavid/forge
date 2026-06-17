import path from "node:path";
import ts from "typescript";
import { compareBytes } from "../primitives/compare.ts";
import { hashStable } from "../primitives/hash.ts";
import { normalizePath } from "../primitives/paths.ts";
import { stableSortStrings } from "../primitives/sort.ts";
import type {
  AppGraph,
  ImportKind,
  LocalImport,
  ModuleGraph,
  ModuleNode,
  PackageImport,
  SourceFile,
} from "../types/app-graph.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import { FORGE_KIND_TO_CONTEXT } from "./forge-apis.ts";
import type { RawSymbol } from "./types.ts";

export function moduleIdForFile(file: string): string {
  return hashStable(normalizePath(file));
}

export function parsePackageSpecifier(
  specifier: string,
): { packageName: string; subpath: string } | null {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:")
  ) {
    return null;
  }

  const parts = specifier.split("/");
  if (specifier.startsWith("@") && parts.length >= 2) {
    return {
      packageName: `${parts[0]}/${parts[1]}`,
      subpath: parts.length > 2 ? `/${parts.slice(2).join("/")}` : "",
    };
  }

  return {
    packageName: parts[0] ?? specifier,
    subpath: parts.length > 1 ? `/${parts.slice(1).join("/")}` : "",
  };
}

function compareModuleNodes(a: ModuleNode, b: ModuleNode): number {
  return compareBytes(a.id, b.id);
}

function stableSortModuleNodes(nodes: ModuleNode[]): ModuleNode[] {
  return [...nodes].sort(compareModuleNodes);
}

function declaredContextsForFile(
  file: string,
  contextsByFile: Map<string, RuntimeContext[]>,
): RuntimeContext[] {
  return contextsByFile.get(file) ?? [];
}

function buildDeclaredContextsByFile(symbols: RawSymbol[]): Map<string, RuntimeContext[]> {
  const mutable = new Map<string, Set<RuntimeContext>>();
  for (const symbol of symbols) {
    const context = FORGE_KIND_TO_CONTEXT[symbol.kind];
    if (context) {
      const fileContexts = mutable.get(symbol.file) ?? new Set<RuntimeContext>();
      fileContexts.add(context);
      mutable.set(symbol.file, fileContexts);
    }
  }

  const byFile = new Map<string, RuntimeContext[]>();
  for (const [file, fileContexts] of mutable) {
    byFile.set(file, stableSortStrings([...fileContexts]) as RuntimeContext[]);
  }
  return byFile;
}

function spanFromNode(node: ts.Node, sourceFile: ts.SourceFile): {
  start: number;
  end: number;
} {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  return { start, end };
}

function resolveLocalTarget(
  specifier: string,
  fromFile: string,
  sourcePaths: Set<string>,
): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = normalizePath(path.join(path.dirname(fromFile), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  if (/\.[cm]?jsx?$/.test(base)) {
    const withoutJsExtension = base.replace(/\.[cm]?jsx?$/, "");
    candidates.push(
      `${withoutJsExtension}.ts`,
      `${withoutJsExtension}.tsx`,
    );
  }

  return candidates.find((candidate) => sourcePaths.has(candidate)) ?? null;
}

function collectImports(
  sourceFile: ts.SourceFile,
  sourcePaths: Set<string>,
): { packageImports: PackageImport[]; localImports: LocalImport[] } {
  const packageImports: PackageImport[] = [];
  const localImports: LocalImport[] = [];
  const fromFile = normalizePath(sourceFile.fileName);

  function recordPackageImport(
    specifier: string,
    parsed: { packageName: string; subpath: string },
    span: { start: number; end: number },
    importKind: ImportKind,
  ): void {
    packageImports.push({
      specifier,
      packageName: parsed.packageName,
      subpath: parsed.subpath,
      span,
      importKind,
    });
  }

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const span = spanFromNode(node.moduleSpecifier, sourceFile);
        const parsed = parsePackageSpecifier(specifier);
        if (parsed) {
          recordPackageImport(specifier, parsed, span, "static");
        } else {
          const target = resolveLocalTarget(
            specifier,
            fromFile,
            sourcePaths,
          );
          if (target) {
            localImports.push({
              toModuleId: moduleIdForFile(target),
              span,
            });
          }
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      const span = spanFromNode(node.arguments[0], sourceFile);
      const parsed = parsePackageSpecifier(specifier);
      if (parsed) {
        recordPackageImport(specifier, parsed, span, "dynamic");
      } else {
        const target = resolveLocalTarget(
          specifier,
          fromFile,
          sourcePaths,
        );
        if (target) {
          localImports.push({
            toModuleId: moduleIdForFile(target),
            span,
          });
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require" &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      const span = spanFromNode(node.arguments[0], sourceFile);
      const parsed = parsePackageSpecifier(specifier);
      if (parsed) {
        recordPackageImport(specifier, parsed, span, "require");
      } else {
        const target = resolveLocalTarget(
          specifier,
          fromFile,
          sourcePaths,
        );
        if (target) {
          localImports.push({
            toModuleId: moduleIdForFile(target),
            span,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { packageImports, localImports };
}

function sourcesUnchangedSincePrior(
  sources: SourceFile[],
  prior?: AppGraph,
  canReusePrior = true,
): boolean {
  if (!prior || !canReusePrior) {
    return false;
  }
  const priorHashes = new Map(Object.entries(prior.sourceHashes ?? {}));
  if (priorHashes.size !== sources.length) {
    return false;
  }
  for (const source of sources) {
    if (priorHashes.get(source.path) !== source.contentHash) {
      return false;
    }
  }
  return true;
}

function priorModuleNodesByFile(prior?: AppGraph): Map<string, ModuleNode> {
  return new Map((prior?.moduleGraph.nodes ?? []).map((node) => [node.file, node]));
}

export function buildModuleGraph(
  sources: SourceFile[],
  rawSymbols: RawSymbol[],
  prior?: AppGraph,
  canReusePrior = true,
): ModuleGraph {
  if (sourcesUnchangedSincePrior(sources, prior, canReusePrior)) {
    return prior!.moduleGraph;
  }

  const priorHashes = new Map(Object.entries(prior?.sourceHashes ?? {}));
  const priorNodes = priorModuleNodesByFile(prior);
  const contextsByFile = buildDeclaredContextsByFile(rawSymbols);
  const sourcePaths = new Set(sources.map((source) => normalizePath(source.path)));

  const nodes: ModuleNode[] = [];

  for (const source of sources) {
    const normalizedFile = normalizePath(source.path);
    const priorNode = priorNodes.get(normalizedFile);
    if (
      canReusePrior &&
      priorNode &&
      priorHashes.get(normalizedFile) === source.contentHash
    ) {
      nodes.push(priorNode);
      continue;
    }

    const sourceFile = ts.createSourceFile(
      normalizedFile,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      normalizedFile.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    if (!sourceFile) {
      nodes.push({
        id: moduleIdForFile(normalizedFile),
        file: normalizedFile,
        directPackageImports: [],
        localImports: [],
        declaredContexts: declaredContextsForFile(normalizedFile, contextsByFile),
        effectiveContexts: [],
      });
      continue;
    }

    const { packageImports, localImports } = collectImports(
      sourceFile,
      sourcePaths,
    );

    nodes.push({
      id: moduleIdForFile(normalizedFile),
      file: normalizedFile,
      directPackageImports: packageImports,
      localImports,
      declaredContexts: declaredContextsForFile(normalizedFile, contextsByFile),
      effectiveContexts: [],
    });
  }

  return { nodes: stableSortModuleNodes(nodes) };
}
