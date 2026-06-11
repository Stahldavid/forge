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
import { loadTsconfig } from "./tsconfig-hash.ts";
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
  symbols: RawSymbol[],
): RuntimeContext[] {
  const contexts = new Set<RuntimeContext>();
  for (const symbol of symbols) {
    if (symbol.file !== file) {
      continue;
    }
    const context = FORGE_KIND_TO_CONTEXT[symbol.kind];
    if (context) {
      contexts.add(context);
    }
  }
  return stableSortStrings([...contexts]) as RuntimeContext[];
}

function spanFromNode(node: ts.Node, sourceFile: ts.SourceFile): {
  start: number;
  end: number;
} {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  return { start, end };
}

function toWorkspaceRelativePath(
  absoluteOrRelativePath: string,
  workspaceRoot: string,
): string {
  const normalized = normalizePath(absoluteOrRelativePath);
  const root = normalizePath(path.resolve(workspaceRoot).replace(/\\/g, "/"));
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`;

  if (normalized.startsWith(rootWithSlash)) {
    return normalized.slice(rootWithSlash.length);
  }

  if (normalized === root) {
    return "";
  }

  return normalized;
}

function resolveLocalTarget(
  specifier: string,
  fromFile: string,
  program: ts.Program,
  workspaceRoot: string,
): string | null {
  const resolved = ts.resolveModuleName(
    specifier,
    fromFile,
    program.getCompilerOptions(),
    ts.sys,
  );

  const fileName = resolved.resolvedModule?.resolvedFileName;
  if (!fileName) {
    return null;
  }

  return toWorkspaceRelativePath(fileName, workspaceRoot);
}

function collectImports(
  sourceFile: ts.SourceFile,
  program: ts.Program,
  workspaceRoot: string,
): { packageImports: PackageImport[]; localImports: LocalImport[] } {
  const packageImports: PackageImport[] = [];
  const localImports: LocalImport[] = [];
  const fromFile = normalizePath(sourceFile.fileName);

  function recordPackageImport(
    specifier: string,
    span: { start: number; end: number },
    importKind: ImportKind,
  ): void {
    const parsed = parsePackageSpecifier(specifier);
    if (!parsed) {
      return;
    }
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
          recordPackageImport(specifier, span, "static");
        } else {
          const target = resolveLocalTarget(
            specifier,
            fromFile,
            program,
            workspaceRoot,
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
        recordPackageImport(specifier, span, "dynamic");
      } else {
        const target = resolveLocalTarget(
          specifier,
          fromFile,
          program,
          workspaceRoot,
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
        recordPackageImport(specifier, span, "require");
      } else {
        const target = resolveLocalTarget(
          specifier,
          fromFile,
          program,
          workspaceRoot,
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
): boolean {
  if (!prior) {
    return false;
  }
  const priorHashes = new Map(
    prior.sources.map((source) => [source.path, source.contentHash]),
  );
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

export function buildModuleGraph(
  sources: SourceFile[],
  rawSymbols: RawSymbol[],
  workspaceRoot: string,
  tsconfigPath?: string,
  prior?: AppGraph,
): ModuleGraph {
  if (sourcesUnchangedSincePrior(sources, prior)) {
    return prior!.moduleGraph;
  }

  const parsedConfig = loadTsconfig(workspaceRoot, tsconfigPath);
  const fileNames = sources.map((source) =>
    path.resolve(workspaceRoot, source.path).replace(/\\/g, "/"),
  );

  const program = ts.createProgram(fileNames, {
    ...parsedConfig.options,
    noEmit: true,
    skipLibCheck: true,
  });

  const nodes: ModuleNode[] = [];

  for (const source of sources) {
    const normalizedFile = normalizePath(source.path);
    const absolutePath = fileNames.find(
      (name) => normalizePath(name).endsWith(normalizedFile),
    );

    const sourceFile = absolutePath
      ? program.getSourceFile(absolutePath)
      : undefined;

    if (!sourceFile) {
      nodes.push({
        id: moduleIdForFile(normalizedFile),
        file: normalizedFile,
        directPackageImports: [],
        localImports: [],
        declaredContexts: declaredContextsForFile(normalizedFile, rawSymbols),
        effectiveContexts: [],
      });
      continue;
    }

    const { packageImports, localImports } = collectImports(
      sourceFile,
      program,
      workspaceRoot,
    );

    nodes.push({
      id: moduleIdForFile(normalizedFile),
      file: normalizedFile,
      directPackageImports: packageImports,
      localImports,
      declaredContexts: declaredContextsForFile(normalizedFile, rawSymbols),
      effectiveContexts: [],
    });
  }

  return { nodes: stableSortModuleNodes(nodes) };
}
